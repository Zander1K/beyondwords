"""define(word, sentence): meaning in the context of this sentence and book (Nemotron).

Also used directly for Word Breakdown when the word was not prepared by page analysis.
"""

import json

from pydantic import BaseModel

from app.brain.llm import LLMClient, Message, get_llm
from app.brain.prompts import load_prompt
from app.brain.settings import get_brain_settings
from app.brain.structured import chat_json
from app.brain.text_utils import syllabify
from app.schemas.brain import BookContext


class Definition(BaseModel):
    word: str
    say_as: str
    meaning: str
    example: str | None = None
    illustratable: bool = False


class WordBreakdown(Definition):
    syllables: list[str]


async def define_word(
    word: str, sentence: str, book: BookContext | None = None, llm: LLMClient | None = None
) -> WordBreakdown:
    settings = get_brain_settings()
    payload = {
        "word": word,
        "sentence": sentence,
        "book": book.model_dump(exclude_none=True) if book else None,
    }
    definition = await chat_json(
        llm or get_llm(),
        [
            Message(role="system", content=load_prompt("define.v1")),
            Message(role="user", content=json.dumps(payload, ensure_ascii=False)),
        ],
        Definition,
        max_tokens=400,
        reasoning=False,
        timeout_s=settings.ask_timeout_s,
    )
    lang = (book.language or "en-GB").replace("-", "_") if book else "en_GB"
    return WordBreakdown(**definition.model_dump(), syllables=syllabify(word, lang))
