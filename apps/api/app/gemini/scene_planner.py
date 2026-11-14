"""Decide whether and what to draw before an illustration is generated.

The real-book test run (apps/api/scripts/illustrate_examples.json) showed that the image model on
its own draws metaphors literally ("the day's wine" became wine barrels), gets period objects
wrong (a four-wheeled hansom cab) and draws sensitive scenes awkwardly. So every request first
goes through a planner that returns:

- illustratable: whether one calm picture can help (no violence, death, abuse; nothing abstract)
- scene: a literal, period-accurate description for the image model to draw

OPEN QUESTION (Mick Ola + Matthew): this is the brain's job (SOP 8.4: Nemotron owns reasoning and
structured data). HACK: until Matthew's brain is connected, `GeminiScenePlanner` uses the Gemini
text model. Swap in a Nemotron planner by implementing `ScenePlanner`; for hard words the page
JSON's `illustratable` flag and `meaning` (SOP 8.1) can feed it directly.
"""

import asyncio
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from google.genai import errors as genai_errors
from google.genai import types

from app.gemini.context import BookContext

logger = logging.getLogger(__name__)

PLAN_VERSION = "illustration_plan_v1"
_PROMPT_PATH = Path(__file__).parents[1] / "brain" / "prompts" / f"{PLAN_VERSION}.txt"
MAX_SCENE_CHARS = 400

_SCHEMA = {
    "type": "object",
    "properties": {
        "illustratable": {"type": "boolean"},
        "scene": {"type": "string", "description": "What to draw; empty when not illustratable."},
        "reason": {"type": "string", "description": "Short spoken reason when not illustratable."},
    },
    "required": ["illustratable", "scene", "reason"],
}


@dataclass(frozen=True)
class ScenePlan:
    illustratable: bool
    scene: str  # what the image model should draw; the original text when no planner ran
    reason: str = ""  # why not, when illustratable is False
    planned: bool = True  # False when the planner was skipped or failed (raw text drawn)


class ScenePlanner(Protocol):
    version: str

    async def plan(self, text: str, kind: str, book: BookContext | None) -> ScenePlan: ...


class PassthroughPlanner:
    """No planning: draw the text as given (tests, or when no model is configured)."""

    version = "passthrough"

    async def plan(self, text: str, kind: str, book: BookContext | None) -> ScenePlan:
        return ScenePlan(illustratable=True, scene=text, planned=False)


def _book_line(book: BookContext | None) -> str:
    if book is None:
        return "Book: unknown."
    parts = [f"Book: {book.title}"]
    if book.author:
        parts.append(f"by {book.author}")
    if book.publication_year:
        parts.append(f"({book.publication_year})")
    line = " ".join(parts) + "."
    if book.setting_era:
        line += f" Setting and era: {book.setting_era}."
    return line


class GeminiScenePlanner:
    """HACK: interim planner on the Gemini text model until Nemotron is connected."""

    version = PLAN_VERSION

    def __init__(self, client: Any, model: str, timeout_seconds: float) -> None:
        self._client = client
        self._model = model
        self._timeout = timeout_seconds
        self._instructions = _PROMPT_PATH.read_text(encoding="utf-8")

    async def plan(self, text: str, kind: str, book: BookContext | None) -> ScenePlan:
        """Plan the picture. On any failure, fall back to drawing the text as given."""
        request = f"{_book_line(book)}\nThe reader asked to see this {kind}: {json.dumps(text)}"
        config = types.GenerateContentConfig(
            system_instruction=self._instructions,
            response_mime_type="application/json",
            response_json_schema=_SCHEMA,
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
            # Thinking tokens count toward this limit; 300 cut the JSON off mid-way in testing.
            max_output_tokens=2048,
        )
        try:
            response = await asyncio.wait_for(
                self._client.aio.models.generate_content(
                    model=self._model, contents=request, config=config
                ),
                timeout=self._timeout,
            )
            data = json.loads(response.text or "")
            illustratable = bool(data["illustratable"])
            scene = " ".join(str(data.get("scene", "")).split())[:MAX_SCENE_CHARS]
            reason = " ".join(str(data.get("reason", "")).split())[:200]
        except (TimeoutError, genai_errors.APIError, ValueError, KeyError, TypeError) as exc:
            # Graceful degradation (CLAUDE.md section 9): the image prompt's own safety rules
            # still apply to the raw text.
            logger.warning(
                "Scene planning failed (%s); drawing the text as given", type(exc).__name__
            )
            return ScenePlan(illustratable=True, scene=text, planned=False)

        if illustratable and not scene:
            return ScenePlan(illustratable=True, scene=text, planned=False)
        return ScenePlan(illustratable=illustratable, scene=scene or "", reason=reason)
