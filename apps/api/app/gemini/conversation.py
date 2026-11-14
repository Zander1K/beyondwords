"""Text conversation with Gemini behind POST /ask (docs/gemini.md, "Conversation").

Voice stays on the phone: it turns the reader's speech into text, sends it here, and speaks the
answer through the glasses with its own text-to-speech. Gemini keeps the conversation going
(follow-ups like "why did he do that?") and calls ask_brain (Nemotron) for book facts.

Per turn: system instruction = coaching rules + current reading context; contents = this
session's earlier turns + the new question. Up to 4 tool steps (SOP 8.2 loop limit).

HACK: sessions live in process memory (lost on restart, one API instance only). Transcripts are
never written to the database or logs, and expire after `session_ttl_seconds` (SOP 10).
TODO(Mick Ola + Matthew): send each finished turn to Nemotron's grounding check (SOP 8.3).
"""

import asyncio
import logging
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Any

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.config import get_settings
from app.gemini.context import ReadingContext, render_context
from app.gemini.images import IllustrationService, get_illustration_service
from app.gemini.tools import DECLARATIONS, Brain, ToolRunner, UnavailableBrain

logger = logging.getLogger(__name__)

PROMPT_VERSION = "reading_coach_v1"
_PROMPT_PATH = Path(__file__).parents[1] / "brain" / "prompts" / f"{PROMPT_VERSION}.txt"
MAX_TOOL_STEPS = 4
MAX_TURNS_KEPT = 10  # earlier question/answer turns sent back to Gemini per session


class ConversationErrorReason(StrEnum):
    NOT_CONFIGURED = "not_configured"  # no GEMINI_API_KEY
    TIMEOUT = "timeout"
    UPSTREAM = "upstream"  # Gemini error (auth, quota, server)
    EMPTY = "empty"  # no answer text (safety block, or tool loop ran out)


class ConversationError(Exception):
    def __init__(self, reason: ConversationErrorReason, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else str(reason))
        self.reason = reason
        self.detail = detail


@dataclass
class _Session:
    turns: list[list[types.Content]] = field(default_factory=list)  # one list per Q&A turn
    updated_at: float = field(default_factory=time.monotonic)


@dataclass(frozen=True)
class Reply:
    session_id: str
    answer: str
    cited_lines: list[str]
    image_url: str | None
    used_brain: bool
    tool_steps: list[str]


def _function_calls(content: types.Content | None) -> list[types.FunctionCall]:
    return [p.function_call for p in (content.parts if content else None) or [] if p.function_call]


def _text(content: types.Content | None) -> str:
    texts = [p.text for p in (content.parts if content else None) or [] if p.text and not p.thought]
    return " ".join(" ".join(texts).split())


class ConversationService:
    def __init__(
        self,
        client: Any | None,
        model: str,
        brain: Brain,
        illustrations: IllustrationService,
        timeout_seconds: float,
        brain_timeout_seconds: float,
        session_ttl_seconds: float,
        max_sessions: int = 500,
    ) -> None:
        self._client = client  # google.genai.Client or a test double; None = not configured
        self._model = model
        self._brain = brain
        self._illustrations = illustrations
        self._timeout = timeout_seconds
        self._brain_timeout = brain_timeout_seconds
        self._ttl = session_ttl_seconds
        self._max_sessions = max_sessions
        self._sessions: OrderedDict[str, _Session] = OrderedDict()
        self._rules = _PROMPT_PATH.read_text(encoding="utf-8")

    def end_session(self, session_id: str) -> None:
        """Forget a conversation now (e.g. the reader closes the book)."""
        self._sessions.pop(session_id, None)

    async def ask(
        self, question: str, context: ReadingContext, session_id: str | None = None
    ) -> Reply:
        if self._client is None:
            raise ConversationError(ConversationErrorReason.NOT_CONFIGURED, "GEMINI_API_KEY unset")

        session_id, session = self._session(session_id)
        config = types.GenerateContentConfig(
            system_instruction=f"{self._rules}\n\n{render_context(context)}",
            tools=[types.Tool(function_declarations=DECLARATIONS)],
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
            # Thinking tokens count toward this limit, so keep headroom; answer length is set by
            # the prompt (two or three sentences), not by this cap.
            max_output_tokens=2048,
        )
        history = [content for turn in session.turns for content in turn]
        turn: list[types.Content] = [
            types.Content(role="user", parts=[types.Part.from_text(text=question)])
        ]
        tools = ToolRunner(self._brain, self._illustrations, context, self._brain_timeout)

        answer = ""
        for _ in range(MAX_TOOL_STEPS + 1):
            content = await self._generate(history + turn, config)
            turn.append(content)
            calls = _function_calls(content)
            if not calls:
                answer = _text(content)
                break
            responses = [
                types.Part.from_function_response(
                    name=call.name or "", response=await tools.run(call.name or "", call.args or {})
                )
                for call in calls
            ]
            turn.append(types.Content(role="user", parts=responses))

        if not answer:
            raise ConversationError(ConversationErrorReason.EMPTY, "no answer text")

        session.turns.append(turn)
        del session.turns[:-MAX_TURNS_KEPT]
        session.updated_at = time.monotonic()
        return Reply(
            session_id=session_id,
            answer=answer,
            cited_lines=tools.outcome.cited_lines,
            image_url=tools.outcome.image_url,
            used_brain=tools.outcome.used_brain,
            tool_steps=tools.outcome.steps,
        )

    async def _generate(
        self, contents: list[types.Content], config: types.GenerateContentConfig
    ) -> types.Content:
        try:
            response = await asyncio.wait_for(
                self._client.aio.models.generate_content(
                    model=self._model, contents=contents, config=config
                ),
                timeout=self._timeout,
            )
        except TimeoutError as exc:
            logger.warning(
                "Conversation timed out after %ss (model=%s)", self._timeout, self._model
            )
            raise ConversationError(ConversationErrorReason.TIMEOUT) from exc
        except genai_errors.APIError as exc:
            logger.warning("Conversation failed: Gemini %s %s", exc.code, exc.status)
            raise ConversationError(
                ConversationErrorReason.UPSTREAM, f"Gemini {exc.code} {exc.status}"
            ) from exc
        candidates = getattr(response, "candidates", None) or []
        content = getattr(candidates[0], "content", None) if candidates else None
        if content is None:
            raise ConversationError(ConversationErrorReason.EMPTY, "no candidate")
        return content

    def _session(self, session_id: str | None) -> tuple[str, _Session]:
        now = time.monotonic()
        for sid in [s for s, v in self._sessions.items() if now - v.updated_at > self._ttl]:
            del self._sessions[sid]
        session_id = session_id or uuid.uuid4().hex
        session = self._sessions.get(session_id)
        if session is None:
            session = self._sessions[session_id] = _Session()
            while len(self._sessions) > self._max_sessions:
                self._sessions.popitem(last=False)
        self._sessions.move_to_end(session_id)
        return session_id, session


@lru_cache
def get_conversation_service() -> ConversationService:
    """FastAPI dependency. Override in tests via app.dependency_overrides."""
    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key) if settings.gemini_api_key else None
    return ConversationService(
        client=client,
        model=settings.gemini_chat_model,
        brain=UnavailableBrain(),  # TODO(Matthew): replace with the Nemotron agent
        illustrations=get_illustration_service(),
        timeout_seconds=settings.gemini_chat_timeout_seconds,
        brain_timeout_seconds=settings.brain_timeout_seconds,
        session_ttl_seconds=settings.conversation_ttl_seconds,
    )
