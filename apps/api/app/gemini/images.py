"""Illustrations via the Gemini image model (docs/gemini.md, "Illustrations").

Owner: Mick Ola. One picture per request, 1:1 at 1K for the 600x600 Ray-Ban Display. The input is
what a reader points at or asks about: a word, a short phrase, or at most one sentence.
Before drawing, a scene planner (app/gemini/scene_planner.py) decides whether the text should be
illustrated at all and turns it into a literal, period-accurate description, so metaphors and
historical objects come out right. Results (and refusals) are cached by (text, book, era, model,
prompt version, planner version): same text in the same book, same picture.

OPEN QUESTION: SOP 8.4 says illustrations are for concrete words only, never whole scenes.
A sentence is closer to a scene; the team must confirm and update the SOP (OPEN_QUESTIONS.md).

Callers: the `illustrate()` tool (Gemini Live / Nemotron agent, still TODO) and the
`POST /illustrate` endpoint. Failures raise `IllustrationError` so callers can degrade
gracefully ("Illustrations are paused. Reading continues.") instead of crashing.

TODO(Mick Ola): send one fixed style reference image with every request once the team picks one.
OPEN QUESTION: deliver as GET /illustrations/{id} (current) or inline base64 (agree with Alex).
"""

import asyncio
import hashlib
import logging
import re
from collections import OrderedDict
from dataclasses import dataclass
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Any

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.config import get_settings
from app.gemini.context import BookContext
from app.gemini.scene_planner import GeminiScenePlanner, PassthroughPlanner, ScenePlanner

logger = logging.getLogger(__name__)

PROMPT_VERSION = "illustrate_v3"
_PROMPT_PATH = Path(__file__).parents[1] / "brain" / "prompts" / f"{PROMPT_VERSION}.txt"

# A word, a short phrase, or one sentence. Never a paragraph or a page.
MAX_TEXT_CHARS = 200
MAX_TEXT_WORDS = 30
MAX_PHRASE_WORDS = 4
# Letters, digits, spaces and everyday sentence punctuation only.
_ALLOWED_RE = re.compile(r"^[\w\s.,;:!?'\"\u2018\u2019\u201c\u201d()\-\u2013\u2014]+$")
_HAS_LETTER_RE = re.compile(r"[^\W\d_]")
# A sentence end (not after a common title) followed by a new word. It only counts as a second
# sentence when that word starts like a sentence; '"Look!" she cried' stays one sentence.
_SENTENCE_END_RE = re.compile(
    r"(?<!\bMr)(?<!\bMrs)(?<!\bMs)(?<!\bDr)(?<!\bSt)[.!?]+[\"\u201d\u2019')]*\s+(\S)"
)
_SENTENCE_OPENERS = "\"'(\u2018\u201c"


def _has_second_sentence(text: str) -> bool:
    for match in _SENTENCE_END_RE.finditer(text):
        nxt = match.group(1)
        if nxt.isupper() or nxt.isdigit() or nxt in _SENTENCE_OPENERS:
            return True
    return False


class TextKind(StrEnum):
    WORD = "word"
    PHRASE = "phrase"
    SENTENCE = "sentence"


class IllustrationErrorReason(StrEnum):
    NOT_CONFIGURED = "not_configured"  # no GEMINI_API_KEY
    NOT_ALLOWED = "not_allowed"  # empty, too long, more than one sentence, or odd characters
    TIMEOUT = "timeout"
    UPSTREAM = "upstream"  # Gemini returned an error (auth, quota, server)
    NO_IMAGE = "no_image"  # Gemini answered without an image (e.g. safety block)
    NOT_SUITABLE = "not_suitable"  # the planner decided a picture would not help (or not be kind)


class IllustrationError(Exception):
    def __init__(self, reason: IllustrationErrorReason, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else str(reason))
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class Illustration:
    id: str
    text: str
    kind: TextKind
    mime_type: str
    data: bytes
    scene: str = ""  # what was actually drawn (the planner's description, or the text itself)
    planned: bool = False  # True when the scene planner shaped the picture


def _not_allowed(detail: str) -> IllustrationError:
    return IllustrationError(IllustrationErrorReason.NOT_ALLOWED, detail)


def classify_text(text: str) -> tuple[str, TextKind]:
    """Normalise whitespace and validate; return the cleaned text and whether it is a word,
    phrase or sentence. Raise NOT_ALLOWED for paragraphs, pages or junk."""
    cleaned = " ".join(text.split())
    if not cleaned or not _HAS_LETTER_RE.search(cleaned):
        raise _not_allowed("send a word, a short phrase or one sentence")
    if len(cleaned) > MAX_TEXT_CHARS or len(cleaned.split()) > MAX_TEXT_WORDS:
        raise _not_allowed(
            f"too long: max one sentence ({MAX_TEXT_WORDS} words, {MAX_TEXT_CHARS} characters)"
        )
    if not _ALLOWED_RE.match(cleaned):
        raise _not_allowed("only letters, numbers and normal punctuation are allowed")
    if _has_second_sentence(cleaned):
        raise _not_allowed("send one sentence at a time")

    words = len(cleaned.split())
    if words == 1:
        return cleaned.strip(".,;:!?\"'\u2018\u2019\u201c\u201d()"), TextKind.WORD
    if words <= MAX_PHRASE_WORDS and not re.search(r"[.!?]$", cleaned):
        return cleaned, TextKind.PHRASE
    return cleaned, TextKind.SENTENCE


def build_prompt(
    text: str, kind: TextKind, setting_era: str | None, scene: str | None = None
) -> str:
    """Image prompt. With a planned `scene`, draw that description; otherwise draw the text."""
    if scene:
        subject = f"A single, simple illustration showing {scene.rstrip('.')}."
    elif kind is TextKind.SENTENCE:
        subject = (
            "A single, simple illustration of the moment described in this sentence: "
            f'"{text}" Show only the main thing happening, in one picture.'
        )
    else:
        subject = f"A single, simple illustration of: {text}."
    era_clause = f" Show it as it would look in {setting_era}." if setting_era else ""
    template = _PROMPT_PATH.read_text(encoding="utf-8")
    return template.format(subject=subject, era_clause=era_clause)


def illustration_id(
    text: str,
    setting_era: str | None,
    model: str,
    book_title: str | None = None,
    planner_version: str = "passthrough",
) -> str:
    key = "|".join(
        [text.lower(), (setting_era or "").lower(), (book_title or "").lower(), model,
         PROMPT_VERSION, planner_version]
    )  # fmt: skip
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]


def _first_image(response: Any) -> tuple[bytes, str] | None:
    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            blob = getattr(part, "inline_data", None)
            if blob is not None and getattr(blob, "data", None):
                return blob.data, blob.mime_type or "image/png"
    return None


class IllustrationService:
    """Generates and caches illustrations. One instance per process."""

    def __init__(
        self,
        client: Any | None,
        model: str,
        timeout_seconds: float,
        cache_size: int,
        planner: ScenePlanner | None = None,
    ) -> None:
        self._client = client  # a google.genai.Client, or a test double; None = not configured
        self._model = model
        self._planner = planner or PassthroughPlanner()
        self._timeout = timeout_seconds
        self._cache_size = cache_size
        # HACK: in-process LRU cache; move to Redis or object storage if we run >1 API instance.
        self._cache: OrderedDict[str, Illustration] = OrderedDict()
        self._refusals: OrderedDict[str, str] = OrderedDict()  # id -> spoken reason
        self._locks: dict[str, asyncio.Lock] = {}

    def get(self, image_id: str) -> Illustration | None:
        found = self._cache.get(image_id)
        if found is not None:
            self._cache.move_to_end(image_id)
        return found

    async def illustrate(
        self, text: str, setting_era: str | None = None, book: BookContext | None = None
    ) -> Illustration:
        """Return a cached or newly generated picture of a word, phrase or one sentence.

        Raises NOT_SUITABLE (with a spoken reason) when the planner decides not to draw it.
        """
        text, kind = classify_text(text)
        setting_era = " ".join(setting_era.split()) if setting_era else None
        if setting_era is None and book is not None:
            setting_era = book.setting_era
        image_id = illustration_id(
            text, setting_era, self._model, book.title if book else None, self._planner.version
        )

        if (cached := self.get(image_id)) is not None:
            return cached
        if image_id in self._refusals:
            raise IllustrationError(IllustrationErrorReason.NOT_SUITABLE, self._refusals[image_id])
        if self._client is None:
            raise IllustrationError(IllustrationErrorReason.NOT_CONFIGURED, "GEMINI_API_KEY unset")

        # One generation per id at a time, so a double tap does not pay twice.
        lock = self._locks.setdefault(image_id, asyncio.Lock())
        try:
            async with lock:
                if (cached := self.get(image_id)) is not None:
                    return cached
                plan = await self._planner.plan(text, kind.value, book)
                if not plan.illustratable:
                    reason = plan.reason or "This part is better explained than pictured."
                    self._refuse(image_id, reason)
                    raise IllustrationError(IllustrationErrorReason.NOT_SUITABLE, reason)
                scene = plan.scene if plan.planned else None
                data, mime_type = await self._generate(build_prompt(text, kind, setting_era, scene))
                illustration = Illustration(
                    image_id, text, kind, mime_type, data, scene=plan.scene, planned=plan.planned
                )
                self._store(illustration)
                return illustration
        finally:
            if not lock.locked():
                self._locks.pop(image_id, None)

    async def _generate(self, prompt: str) -> tuple[bytes, str]:
        config = types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(aspect_ratio="1:1", image_size="1K"),
        )
        try:
            response = await asyncio.wait_for(
                self._client.aio.models.generate_content(
                    model=self._model, contents=prompt, config=config
                ),
                timeout=self._timeout,
            )
        except TimeoutError as exc:
            logger.warning(
                "Illustration timed out after %ss (model=%s)", self._timeout, self._model
            )
            raise IllustrationError(IllustrationErrorReason.TIMEOUT) from exc
        except genai_errors.APIError as exc:
            logger.warning("Illustration failed: Gemini %s %s", exc.code, exc.status)
            raise IllustrationError(
                IllustrationErrorReason.UPSTREAM, f"Gemini {exc.code} {exc.status}"
            ) from exc

        image = _first_image(response)
        if image is None:
            logger.warning("Illustration response had no image (model=%s)", self._model)
            raise IllustrationError(IllustrationErrorReason.NO_IMAGE)
        return image

    def _refuse(self, image_id: str, reason: str) -> None:
        self._refusals[image_id] = reason
        while len(self._refusals) > self._cache_size:
            self._refusals.popitem(last=False)

    def _store(self, illustration: Illustration) -> None:
        self._cache[illustration.id] = illustration
        self._cache.move_to_end(illustration.id)
        while len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)


@lru_cache
def get_illustration_service() -> IllustrationService:
    """FastAPI dependency. Override in tests via app.dependency_overrides."""
    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key) if settings.gemini_api_key else None
    planner: ScenePlanner = (
        GeminiScenePlanner(
            client, settings.gemini_chat_model, settings.illustration_plan_timeout_seconds
        )
        if client is not None
        else PassthroughPlanner()
    )
    return IllustrationService(
        client=client,
        model=settings.gemini_image_model,
        timeout_seconds=settings.gemini_image_timeout_seconds,
        cache_size=settings.illustration_cache_size,
        planner=planner,
    )
