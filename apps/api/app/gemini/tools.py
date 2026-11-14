"""Tools Gemini can call during a conversation: ask_brain and illustrate (docs/gemini.md).

`ask_brain` is the contract with the brain (Matthew, app/brain/agent.py): Gemini handles the
conversation, Nemotron answers book questions grounded in captured pages, with cited line ids.
OPEN QUESTION (Mick Ola + Matthew): confirm the `Brain` interface below before Matthew builds it.
Until then `UnavailableBrain` is used, and Gemini answers from the page text alone.

TODO(Mick Ola): add_to_word_bank once conversations know the user (needs POST /session).
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

from google.genai import types

from app.gemini.context import ReadingContext
from app.gemini.images import IllustrationError, IllustrationErrorReason, IllustrationService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BrainAnswer:
    text: str
    cited_lines: list[str] = field(default_factory=list)


class BrainUnavailableError(Exception):
    """The brain (Nemotron) is down, slow or not built yet."""


class Brain(Protocol):
    async def ask(self, question: str, context: ReadingContext) -> BrainAnswer:
        """Grounded answer from captured pages and book context, citing line ids (SOP 8.2)."""
        ...


class UnavailableBrain:
    """Stand-in until Matthew's agent exists. Always unavailable."""

    async def ask(self, question: str, context: ReadingContext) -> BrainAnswer:
        raise BrainUnavailableError("brain not connected yet")


DECLARATIONS = [
    types.FunctionDeclaration(
        name="ask_brain",
        description=(
            "Ask the book expert about this book: what happened, why a character did something, "
            "what a passage means, history or culture behind it. Answers only from pages the "
            "reader has already read, with cited line ids."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "The reader's question, in full."}
            },
            "required": ["question"],
        },
    ),
    types.FunctionDeclaration(
        name="illustrate",
        description=(
            "Show a simple picture on the reader's display of a concrete word, short phrase or "
            "one sentence from the page."
        ),
        parameters_json_schema={
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "A word, a short phrase, or one sentence to picture.",
                }
            },
            "required": ["text"],
        },
    ),
]


@dataclass
class ToolOutcome:
    """What the tools produced during one turn, beyond Gemini's spoken text."""

    used_brain: bool = False
    cited_lines: list[str] = field(default_factory=list)
    image_url: str | None = None
    steps: list[str] = field(default_factory=list)  # tool names, in order (for the trace screen)


class ToolRunner:
    def __init__(
        self,
        brain: Brain,
        illustrations: IllustrationService,
        context: ReadingContext,
        brain_timeout_seconds: float,
    ) -> None:
        self._brain = brain
        self._illustrations = illustrations
        self._context = context
        self._brain_timeout = brain_timeout_seconds
        self.outcome = ToolOutcome()

    async def run(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Run one tool call; always return a dict Gemini can read, never raise."""
        self.outcome.steps.append(name)
        if name == "ask_brain":
            return await self._ask_brain(str(args.get("question", "")))
        if name == "illustrate":
            return await self._illustrate(str(args.get("text", "")))
        logger.warning("Gemini called unknown tool %r", name)
        return {"error": f"unknown tool {name}"}

    async def _ask_brain(self, question: str) -> dict[str, Any]:
        try:
            answer = await asyncio.wait_for(
                self._brain.ask(question, self._context), timeout=self._brain_timeout
            )
        except (BrainUnavailableError, TimeoutError) as exc:
            logger.info("ask_brain unavailable: %s", type(exc).__name__)
            return {
                "error": "The book expert is unavailable right now. Answer from the page text "
                "if it answers the question; otherwise say briefly you are not sure yet."
            }
        self.outcome.used_brain = True
        for line_id in answer.cited_lines:
            if line_id not in self.outcome.cited_lines:
                self.outcome.cited_lines.append(line_id)
        return {"answer": answer.text, "cited_lines": answer.cited_lines}

    async def _illustrate(self, text: str) -> dict[str, Any]:
        try:
            result = await self._illustrations.illustrate(text, book=self._context.book)
        except IllustrationError as exc:
            logger.info("illustrate tool failed: %s", exc.reason)
            if exc.reason is IllustrationErrorReason.NOT_SUITABLE:
                return {"error": "No picture for this; explain it in words instead. "
                        "Do not mention a picture."}  # fmt: skip
            return {"error": "Pictures are unavailable right now. Do not mention a picture."}
        self.outcome.image_url = f"/illustrations/{result.id}"
        return {"shown": True, "picture_shows": result.scene}
