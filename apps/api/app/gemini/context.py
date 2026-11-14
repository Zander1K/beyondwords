"""The reading context added to every conversation turn (docs/gemini.md, "Conversation").

Context goes into the system instruction on every request, not into the stored history, so it is
always the current page and never depends on a tool call firing (SOP 8.3, CLAUDE.md section 7).
Plot and character facts come only from captured pages (SOP 8.5).

HACK: the phone sends the current page's lines with each question. Once POST /page stores pages
and lines (Matthew), look them up server-side from a page id instead.
"""

import logging
from dataclasses import dataclass, field

from app.books.library import Library, LibraryError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PageLine:
    id: str  # line id from the page JSON, e.g. "L2"
    text: str


@dataclass(frozen=True)
class BookContext:
    title: str
    author: str | None = None
    publication_year: int | None = None
    genre: str | None = None
    setting_era: str | None = None


@dataclass(frozen=True)
class ReadingContext:
    book: BookContext | None = None
    page_lines: list[PageLine] = field(default_factory=list)
    current_line_id: str | None = None  # the line the reader's finger is on


def render_context(context: ReadingContext) -> str:
    """Plain-text block appended to the system instruction."""
    parts: list[str] = []
    if context.book is not None:
        b = context.book
        details = [f"Title: {b.title}"]
        if b.author:
            details.append(f"Author: {b.author}")
        if b.publication_year:
            details.append(f"Published: {b.publication_year}")
        if b.genre:
            details.append(f"Genre: {b.genre}")
        if b.setting_era:
            details.append(f"Setting and era: {b.setting_era}")
        parts.append("BOOK\n" + "\n".join(details))
    else:
        parts.append("BOOK\nUnknown (the reader has not scanned the book yet).")

    if context.page_lines:
        lines = "\n".join(f"[{line.id}] {line.text}" for line in context.page_lines)
        parts.append("PAGE TEXT (the page the reader is on)\n" + lines)
    else:
        parts.append("PAGE TEXT\nNone captured yet.")

    if context.current_line_id:
        parts.append(f"The reader's finger is on line {context.current_line_id}.")
    return "\n\n".join(parts)


async def load_book_context(library: Library, book_id: int | None) -> BookContext | None:
    """Book details for a request. A missing or unreachable book never blocks the request."""
    if book_id is None:
        return None
    try:
        book = await library.get(book_id)
    except LibraryError:
        logger.warning("Book %s unavailable for context; continuing without it", book_id)
        return None
    if book is None:
        return None
    return BookContext(
        title=book.title,
        author=book.author,
        publication_year=book.publication_year,
        genre=book.genre,
        setting_era=book.setting_era,
    )
