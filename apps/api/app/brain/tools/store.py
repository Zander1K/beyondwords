"""What the brain needs from the database and from Gemini images, as interfaces.

The brain never imports `app.db` or `app.gemini`. Mick Ola implements these two protocols
with the MariaDB repositories and the Gemini image client, and passes them in. Until then,
`InMemoryStore` and `NoIllustrator` keep tests, eval and local runs working.
"""

from typing import Protocol

from app.schemas.brain import BookContext, CapturedPage


class BrainStore(Protocol):
    async def get_book_context(self, book_id: int) -> BookContext | None:
        """Row from `books` (metadata only)."""
        ...

    async def get_captured_pages(
        self, user_id: int, book_id: int, page_numbers: list[int] | None = None
    ) -> list[CapturedPage]:
        """Pages this reader has captured in this book, from `pages` + `lines`.

        `page_numbers=None` means all captured pages. Must never return pages the reader has
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
        """Insert into `word_bank`, or bump `times_rescued` if the word is already there."""
        ...


class Illustrator(Protocol):
    async def illustrate(self, concept: str, style_hint: str | None = None) -> str | None:
        """Generate a picture of one concrete thing; return a URL the phone can show."""
        ...


class InMemoryStore:
    """Dev/test stand-in for the MariaDB repositories."""

    def __init__(
        self,
        books: dict[int, BookContext] | None = None,
        pages: dict[tuple[int, int], list[CapturedPage]] | None = None,
    ) -> None:
        self.books = books or {}
        self.pages = pages or {}  # (user_id, book_id) -> captured pages
        self.word_bank: list[dict] = []

    async def get_book_context(self, book_id: int) -> BookContext | None:
        return self.books.get(book_id)

    async def get_captured_pages(
        self, user_id: int, book_id: int, page_numbers: list[int] | None = None
    ) -> list[CapturedPage]:
        pages = self.pages.get((user_id, book_id), [])
        if page_numbers is None:
            return pages
        return [p for p in pages if p.page_number in page_numbers]

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


class NoIllustrator:
    async def illustrate(self, concept: str, style_hint: str | None = None) -> str | None:
        return None
