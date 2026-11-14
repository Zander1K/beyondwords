"""What the brain needs from the database and from Gemini images, as interfaces.

The brain never imports `app.db` or `app.gemini`. Mick Ola implements these two protocols
with the MariaDB repositories and the Gemini image client, and passes them in. Until then,
`InMemoryStore` and `NoIllustrator` keep tests, eval and local runs working.
"""

from typing import Protocol

from app.brain.word_bank import WordBankStore, record_rescue
from app.schemas.brain import BookContext, CapturedPage


class BrainStore(Protocol):
    async def get_book_context(self, book_id: int) -> BookContext | None:
        """Row from `books` (metadata only)."""
        ...

    async def get_captured_pages(
        self, user_id: int, book_id: int, page_numbers: list[str] | None = None
    ) -> list[CapturedPage]:
        """Pages this reader has captured in this book, from `pages` + `lines`.

        `page_numbers` are printed labels matching `pages.page_number` ("12", "xiv");
        `None` means all captured pages. Must never return pages the reader has
        not captured: that is what keeps answers spoiler-free.
        """
        ...

    async def add_to_word_bank(
        self,
        user_id: int,
        book_id: int | None,
        word: str,
        context_sentence: str | None,
        page_id: str | None,
    ) -> None:
        """The reader needed help with `word` (a rescue): add it to their word bank, or send it
        back to learning. Implementations call brain.word_bank.record_rescue, which holds the
        rules; storage is a WordBankStore."""
        ...


class Illustrator(Protocol):
    async def illustrate(self, concept: str, style_hint: str | None = None) -> str | None:
        """Generate a picture of one concrete thing; return a URL the phone can show."""
        ...


class InMemoryStore:
    """Dev/test stand-in for the database. Books and pages live in memory; word bank writes go
    to `words` when given (e.g. the real `word_bank` table), otherwise they are only listed."""

    def __init__(
        self,
        books: dict[int, BookContext] | None = None,
        pages: dict[tuple[int, int], list[CapturedPage]] | None = None,
        words: WordBankStore | None = None,
    ) -> None:
        self.books = books or {}
        self.pages = pages or {}  # (user_id, book_id) -> captured pages
        self.words = words
        self.word_bank: list[dict] = []

    async def get_book_context(self, book_id: int) -> BookContext | None:
        return self.books.get(book_id)

    async def get_captured_pages(
        self, user_id: int, book_id: int, page_numbers: list[str] | None = None
    ) -> list[CapturedPage]:
        pages = self.pages.get((user_id, book_id), [])
        if page_numbers is None:
            return pages
        wanted = {n.strip().lower() for n in page_numbers}
        return [p for p in pages if (p.page_number or "").lower() in wanted]

    async def add_to_word_bank(
        self,
        user_id: int,
        book_id: int | None,
        word: str,
        context_sentence: str | None,
        page_id: str | None,
    ) -> None:
        self.word_bank.append(
            {
                "user_id": user_id,
                "book_id": book_id,
                "word": word,
                "context_sentence": context_sentence,
                "page_id": page_id,
            }
        )
        if self.words is not None:
            await record_rescue(
                self.words,
                user_id,
                word,
                sentence=context_sentence,
                book_id=book_id,
                page_id=page_id,
            )


class NoIllustrator:
    async def illustrate(self, concept: str, style_hint: str | None = None) -> str | None:
        return None
