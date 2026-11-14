"""read_cover(photo): the ISBN, title and author printed on a book, from a photo (Nemotron VL).

The reader photographs the barcode, the copyright page or the cover; the model reads what is
printed. A model can misread digits, so an ISBN is only kept if its check digit adds up
(`normalise_isbn`); otherwise it is dropped and the title and author are used to find the book.
The photo is sent to the model and never stored.
"""

import logging

from pydantic import BaseModel

from app.books.isbn import InvalidISBNError, normalise_isbn
from app.brain.llm import LLMClient, Message, get_llm, image_part, text_part
from app.brain.prompts import load_prompt
from app.brain.settings import get_brain_settings
from app.brain.structured import chat_json

logger = logging.getLogger(__name__)


class CoverRead(BaseModel):
    isbn: str | None = None
    title: str | None = None
    author: str | None = None


def sniff_mime(image: bytes) -> str:
    """The image's type from its first bytes (the model needs it to read the photo)."""
    if image.startswith(b"\x89PNG"):
        return "image/png"
    if image[:4] == b"RIFF" and image[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


def _clean(value: str | None) -> str | None:
    value = " ".join((value or "").split())
    return value or None


async def read_cover(image: bytes, llm: LLMClient | None = None) -> CoverRead:
    settings = get_brain_settings()
    draft = await chat_json(
        llm or get_llm(),
        [
            Message(role="system", content=load_prompt("read_cover.v1")),
            Message(
                role="user",
                content=[
                    text_part("Here is the photo. Read the ISBN, title and author."),
                    image_part(image, sniff_mime(image)),
                ],
            ),
        ],
        CoverRead,
        max_tokens=300,
        reasoning=False,
        timeout_s=settings.cover_timeout_s,
    )
    isbn: str | None = None
    if draft.isbn:
        try:
            isbn = normalise_isbn(
                draft.isbn
            )  # the check digit is the proof the digits were read right
        except InvalidISBNError:
            logger.info("Dropped an ISBN read from a photo: its check digit does not add up")
    return CoverRead(isbn=isbn, title=_clean(draft.title), author=_clean(draft.author))
