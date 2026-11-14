"""Agent tools (SOP 8.2) and the context they run in.

Each tool is an async function `(ctx, **args) -> dict` plus an OpenAI-style schema in
`TOOL_SPECS`. `run_tool()` executes one call and never raises: a failing tool returns
{"error": ...} so the agent can carry on (reading never stops).
"""

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from app.brain.llm import LLMClient
from app.brain.text_utils import page_order
from app.brain.text_utils import syllabify as _syllabify
from app.brain.tools.define import define_word
from app.brain.tools.store import BrainStore, Illustrator, NoIllustrator
from app.schemas.brain import BookContext, CapturedPage

logger = logging.getLogger(__name__)


@dataclass
class ToolContext:
    user_id: int
    book_id: int | None
    store: BrainStore
    llm: LLMClient
    # Printed label of the furthest page reached ("12", "xiv"); nothing beyond it is fetched.
    current_page_number: str | None = None
    illustrator: Illustrator = field(default_factory=NoIllustrator)
    book: BookContext | None = None
    # "page_id:line_id" -> text for every line the answer may cite. Grows as tools fetch pages.
    known_lines: dict[str, str] = field(default_factory=dict)
    image_url: str | None = None

    def remember(self, pages: list[CapturedPage]) -> None:
        for page in pages:
            for line in page.lines:
                self.known_lines[f"{page.page_id}:{line.id}"] = line.text


def _page_view(page: CapturedPage) -> dict[str, Any]:
    return {
        "page_id": page.page_id,
        "page_number": page.page_number,
        "lines": [{"cite": f"{page.page_id}:{line.id}", "text": line.text} for line in page.lines],
    }


def _not_beyond(page: CapturedPage, limit: tuple[int, int] | None) -> bool:
    # Unknown labels are kept: the store only returns captured pages, which is the real guard.
    order = page_order(page.page_number)
    return limit is None or order is None or order <= limit


async def get_captured_pages(ctx: ToolContext, page_numbers: list[str | int] | None = None) -> dict:
    if ctx.book_id is None:
        return {"pages": [], "note": "No book is set for this session."}
    labels = [str(n).strip() for n in page_numbers] if page_numbers is not None else None
    pages = await ctx.store.get_captured_pages(ctx.user_id, ctx.book_id, labels)
    # No spoilers, even if the store returns more.
    limit = page_order(ctx.current_page_number)
    pages = [p for p in pages if _not_beyond(p, limit)]
    ctx.remember(pages)
    return {"pages": [_page_view(p) for p in pages[-10:]]}


async def get_book_context(ctx: ToolContext) -> dict:
    if ctx.book is None and ctx.book_id is not None:
        ctx.book = await ctx.store.get_book_context(ctx.book_id)
    if ctx.book is None:
        return {"book": None}
    return {"book": ctx.book.model_dump(exclude_none=True)}


async def syllabify(ctx: ToolContext, word: str) -> dict:
    return {"word": word, "syllables": _syllabify(word)}


async def define(ctx: ToolContext, word: str, sentence: str) -> dict:
    result = await define_word(word, sentence, ctx.book, llm=ctx.llm)
    return result.model_dump()


async def illustrate(ctx: ToolContext, concept: str) -> dict:
    url = await ctx.illustrator.illustrate(concept)
    if url:
        ctx.image_url = url
        return {"image_url": url, "shown": True}
    return {"shown": False, "note": "Pictures are not available right now."}


async def add_to_word_bank(ctx: ToolContext, word: str, sentence: str | None = None) -> dict:
    await ctx.store.add_to_word_bank(ctx.user_id, ctx.book_id, word, sentence, None)
    return {"saved": word}


ToolFn = Callable[..., Awaitable[dict]]

TOOLS: dict[str, ToolFn] = {
    "get_captured_pages": get_captured_pages,
    "get_book_context": get_book_context,
    "syllabify": syllabify,
    "define": define,
    "illustrate": illustrate,
    "add_to_word_bank": add_to_word_bank,
}


def _spec(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required},
        },
    }


_WORD = {"type": "string", "description": "The word as printed"}
_SENTENCE = {"type": "string", "description": "The sentence the word appears in"}

TOOL_SPECS: list[dict] = [
    _spec(
        "get_captured_pages",
        "Lines from pages the reader has already captured in this book, with cite keys.",
        {
            "page_numbers": {
                "type": "array",
                "items": {"type": "string"},
                "description": 'Printed page numbers to fetch, e.g. ["11", "12"]; omit for all',
            }
        },
        [],
    ),
    _spec("get_book_context", "Title, author, year, genre, era and setting of the book.", {}, []),
    _spec("syllabify", "Split a word into syllables.", {"word": _WORD}, ["word"]),
    _spec(
        "define",
        "Plain meaning and pronunciation of a word in this sentence and this book.",
        {"word": _WORD, "sentence": _SENTENCE},
        ["word", "sentence"],
    ),
    _spec(
        "illustrate",
        "Show the reader a picture of one concrete thing. Only when they ask to see it.",
        {"concept": {"type": "string", "description": "The concrete thing, e.g. 'portcullis'"}},
        ["concept"],
    ),
    _spec(
        "add_to_word_bank",
        "Save a word the reader found hard.",
        {"word": _WORD, "sentence": _SENTENCE},
        ["word"],
    ),
]


async def run_tool(ctx: ToolContext, name: str, raw_arguments: str) -> dict:
    fn = TOOLS.get(name)
    if fn is None:
        return {"error": f"Unknown tool {name!r}"}
    try:
        args = json.loads(raw_arguments or "{}")
        if not isinstance(args, dict):
            raise ValueError("arguments must be a JSON object")
        return await fn(ctx, **args)
    except Exception as exc:  # a broken tool must never end the conversation
        logger.warning("Tool %s failed: %r", name, exc)
        return {"error": f"{name} failed: {type(exc).__name__}"}
