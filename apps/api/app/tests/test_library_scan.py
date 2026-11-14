"""Reading a book from a photo, and a reader's library: the cover reader, the library's
title fallback, background context, and the /users/{id}/books routes. No network, no real model."""

from collections.abc import Iterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.books.enrich import enrich_book
from app.books.library import Library, LibraryError, LibraryErrorReason
from app.books.providers import BookMetadata
from app.brain.llm import LLMError
from app.brain.tools.describe_book import BookBackground, describe_book
from app.brain.tools.read_cover import CoverRead, read_cover, sniff_mime
from app.db.models import Book, User
from app.db.repositories.books import BookRepository
from app.db.session import get_session
from app.main import app
from app.routers import user_books
from app.routers.books import get_library
from app.tests.brain_fakes import FakeLLM

GOOD_ISBN = "9780141439518"  # Pride and Prejudice, a valid ISBN-13


# --- the cover reader ------------------------------------------------------------------------


async def test_a_valid_isbn_read_from_the_photo_is_kept_and_normalised() -> None:
    llm = FakeLLM({"isbn": "978-0-14-143951-8", "title": "  Pride and  Prejudice ", "author": None})
    cover = await read_cover(b"\xff\xd8jpeg", llm)
    assert cover == CoverRead(isbn=GOOD_ISBN, title="Pride and Prejudice", author=None)
    # The photo went to the model as an image, and was typed correctly.
    parts = llm.calls[0]["messages"][1].content
    assert any(p.get("type") == "image_url" for p in parts)


async def test_misread_digits_are_dropped_and_the_title_is_kept() -> None:
    llm = FakeLLM(
        {"isbn": "9780141439519", "title": "Pride and Prejudice", "author": "Jane Austen"}
    )
    cover = await read_cover(b"\xff\xd8jpeg", llm)
    assert cover.isbn is None  # the check digit does not add up: do not trust it
    assert (cover.title, cover.author) == ("Pride and Prejudice", "Jane Austen")


def test_image_types_are_recognised() -> None:
    assert sniff_mime(b"\x89PNG....") == "image/png"
    assert sniff_mime(b"RIFF1234WEBPxx") == "image/webp"
    assert sniff_mime(b"\xff\xd8\xff") == "image/jpeg"


async def test_book_background_is_kept_short_and_null_when_unsure() -> None:
    ok = FakeLLM(
        {"setting_era": "Victorian London", "description_spoiler_free": "A novel about manners."}
    )
    bg = await describe_book(title="T", author=None, year=None, genre=None, llm=ok)
    assert bg == BookBackground(
        setting_era="Victorian London", description_spoiler_free="A novel about manners."
    )
    wordy = FakeLLM({"setting_era": None, "description_spoiler_free": " ".join(["word"] * 60)})
    assert (
        await describe_book(title="T", author=None, year=None, genre=None, llm=wordy)
    ).description_spoiler_free is None


# --- the library: from a cover ---------------------------------------------------------------


class FakeStore:
    def __init__(self) -> None:
        self.books: list[Book] = []

    async def get(self, book_id: int) -> Book | None:
        return next((b for b in self.books if b.id == book_id), None)

    async def get_by_isbn(self, isbn: str) -> Book | None:
        return next((b for b in self.books if b.isbn == isbn), None)

    async def add(self, book: Book) -> Book:
        book.id = len(self.books) + 1
        self.books.append(book)
        return book

    async def set_context(self, book_id: int, era: str | None, desc: str | None) -> Book | None:
        return await self.get(book_id)


class FakeMetadata:
    def __init__(self, by_isbn: BookMetadata | None = None, by_title: BookMetadata | None = None):
        self.by_isbn, self.by_title = by_isbn, by_title
        self.searched: list[tuple[str, str | None]] = []

    async def lookup(self, isbn13: str) -> BookMetadata | None:
        return self.by_isbn

    async def search(self, title: str, author: str | None = None) -> BookMetadata | None:
        self.searched.append((title, author))
        return self.by_title


def _meta(isbn: str = GOOD_ISBN) -> BookMetadata:
    return BookMetadata(
        isbn, "Pride and Prejudice", "Jane Austen", 1813, "en", "Fiction", "open_library"
    )


async def test_an_isbn_from_the_photo_identifies_and_stores_the_book() -> None:
    library = Library(FakeStore(), FakeMetadata(by_isbn=_meta()))  # type: ignore[arg-type]
    result = await library.identify_from_cover(GOOD_ISBN, None, None)
    assert (result.book.title, result.found_by, result.cached) == (
        "Pride and Prejudice",
        "isbn",
        False,
    )


async def test_without_an_isbn_the_printed_title_is_searched_and_resolved_to_an_isbn() -> None:
    metadata = FakeMetadata(by_isbn=_meta(), by_title=_meta())
    library = Library(FakeStore(), metadata)  # type: ignore[arg-type]
    result = await library.identify_from_cover(None, "Pride and Prejudice", "Jane Austen")
    assert metadata.searched == [("Pride and Prejudice", "Jane Austen")]
    assert (result.found_by, result.book.isbn) == ("title", GOOD_ISBN)
    # Scanning the same book again finds it in the library: no second lookup.
    again = await library.identify_from_cover(None, "Pride and Prejudice", "Jane Austen")
    assert again.cached is True


async def test_nothing_readable_or_nothing_found_is_not_found() -> None:
    library = Library(FakeStore(), FakeMetadata())  # type: ignore[arg-type]
    with pytest.raises(LibraryError) as none_read:
        await library.identify_from_cover(None, None, None)
    assert none_read.value.reason is LibraryErrorReason.NOT_FOUND
    with pytest.raises(LibraryError) as no_match:
        await library.identify_from_cover(None, "A Book Nobody Knows", None)
    assert no_match.value.reason is LibraryErrorReason.NOT_FOUND


# --- background context ----------------------------------------------------------------------


async def test_a_new_books_background_is_filled_in_but_never_overwrites(db: AsyncSession) -> None:
    book = Book(title="Lantern Days", author="A. Writer", setting_era=None)
    db.add(book)
    await db.commit()
    maker = async_sessionmaker(db.bind, expire_on_commit=False)  # type: ignore[arg-type]

    async def describe(**_: Any) -> BookBackground:
        return BookBackground(
            setting_era="A harbour town", description_spoiler_free="A quiet tale."
        )

    await enrich_book(book.id, sessions=maker, describe=describe)
    saved = await BookRepository(db).get(book.id)
    await db.refresh(saved)  # type: ignore[arg-type]
    assert (saved.setting_era, saved.description_spoiler_free) == (
        "A harbour town",
        "A quiet tale.",
    )  # type: ignore[union-attr]

    async def other(**_: Any) -> BookBackground:
        return BookBackground(setting_era="Somewhere else", description_spoiler_free="Different.")

    await enrich_book(book.id, sessions=maker, describe=other)
    await db.refresh(saved)  # type: ignore[arg-type]
    assert saved.setting_era == "A harbour town"  # already there: untouched


async def test_a_failing_model_never_breaks_enrichment(db: AsyncSession) -> None:
    book = Book(title="X")
    db.add(book)
    await db.commit()
    maker = async_sessionmaker(db.bind, expire_on_commit=False)  # type: ignore[arg-type]

    async def boom(**_: Any) -> BookBackground:
        raise LLMError("down")

    await enrich_book(book.id, sessions=maker, describe=boom)  # does not raise


# --- the routes ------------------------------------------------------------------------------


@pytest.fixture
async def client(db: AsyncSession) -> Iterator[AsyncClient]:
    # The real repository on the test database, so the reader's library joins to real books.
    library = Library(BookRepository(db), FakeMetadata(by_isbn=_meta(), by_title=_meta()))
    app.dependency_overrides[get_session] = lambda: db
    app.dependency_overrides[get_library] = lambda: library
    enriched: list[int] = []

    async def fake_enrich(book_id: int) -> None:
        enriched.append(book_id)

    user_books.enrich_book = fake_enrich  # type: ignore[assignment]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.enriched = enriched  # type: ignore[attr-defined]
        yield c
    app.dependency_overrides.clear()


async def _make_reader(db: AsyncSession) -> int:
    user = User(username="ada")
    db.add(user)
    await db.commit()
    return user.id


async def test_scanning_a_cover_stores_the_book_adds_it_to_the_readers_library(
    client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    uid = await _make_reader(db)

    async def fake_read(photo: bytes) -> CoverRead:
        assert photo == b"PHOTO"
        return CoverRead(isbn=GOOD_ISBN, title="Pride and Prejudice", author="Jane Austen")

    monkeypatch.setattr(user_books, "read_cover", fake_read)
    r = await client.post(f"/users/{uid}/books/scan", content=b"PHOTO")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["title"], body["found_by"], body["cached"]) == (
        "Pride and Prejudice",
        "isbn",
        False,
    )
    assert body["read"]["isbn"] == GOOD_ISBN
    assert client.enriched == [body["id"]]  # type: ignore[attr-defined]
    mine = (await client.get(f"/users/{uid}/books")).json()
    assert [b["title"] for b in mine] == ["Pride and Prejudice"]


async def test_scan_errors_are_clear(
    client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    uid = await _make_reader(db)
    assert (await client.post(f"/users/{uid}/books/scan", content=b"")).status_code == 422
    assert (await client.post("/users/999/books/scan", content=b"x")).status_code == 404

    async def nothing(photo: bytes) -> CoverRead:
        return CoverRead()

    monkeypatch.setattr(user_books, "read_cover", nothing)
    r = await client.post(f"/users/{uid}/books/scan", content=b"x")
    assert r.status_code == 422 and "couldn't read" in r.json()["detail"]

    async def down(photo: bytes) -> CoverRead:
        raise LLMError("down")

    monkeypatch.setattr(user_books, "read_cover", down)
    r = await client.post(f"/users/{uid}/books/scan", content=b"x")
    assert r.status_code == 503 and "ISBN" in r.json()["detail"]  # offers the typed way


async def test_adding_by_typed_isbn_and_opening_a_book_makes_it_current(
    client: AsyncClient, db: AsyncSession
) -> None:
    uid = await _make_reader(db)
    added = await client.post(f"/users/{uid}/books", json={"isbn": GOOD_ISBN})
    assert added.status_code == 200 and added.json()["title"] == "Pride and Prejudice"
    book_id = added.json()["id"]
    assert (await client.put(f"/users/{uid}/books/{book_id}/open")).status_code == 200
    assert (await client.put(f"/users/{uid}/books/12345/open")).status_code == 404  # not theirs
    assert (
        await client.post(f"/users/{uid}/books", json={"isbn": "1234567890123"})
    ).status_code == 422


# --- the word bank routes --------------------------------------------------------------------


async def test_looking_words_up_fills_the_word_bank_with_the_book_and_sentence(
    client: AsyncClient, db: AsyncSession
) -> None:
    uid = await _make_reader(db)
    book = (await client.post(f"/users/{uid}/books", json={"isbn": GOOD_ISBN})).json()
    first = await client.post(
        f"/users/{uid}/words",
        json={"word": "Portcullis,", "sentence": "The portcullis rose.", "book_id": book["id"]},
    )
    assert first.status_code == 200, first.text
    assert (first.json()["word"], first.json()["times_rescued"]) == ("portcullis", 1)
    again = await client.post(f"/users/{uid}/words", json={"word": "portcullis", "source": "ask"})
    assert again.json()["times_rescued"] == 2
    words = (await client.get(f"/users/{uid}/words")).json()
    assert len(words) == 1
    assert words[0]["book_title"] == "Pride and Prejudice"
    assert words[0]["context_sentence"] == "The portcullis rose."


async def test_word_bank_route_edge_cases(client: AsyncClient, db: AsyncSession) -> None:
    uid = await _make_reader(db)
    assert (await client.post(f"/users/{uid}/words", json={"word": "qzx7"})).status_code == 422
    assert (await client.post("/users/999/words", json={"word": "lantern"})).status_code == 404
    # A book id that is not in the library does not stop the word being saved.
    ok = await client.post(f"/users/{uid}/words", json={"word": "lantern", "book_id": 424242})
    assert ok.status_code == 200 and ok.json()["book_id"] is None
