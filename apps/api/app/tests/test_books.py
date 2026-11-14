"""Barcode -> book lookup: ISBN parsing, Google Books / Open Library clients, library, endpoints.

No network and no database: HTTP goes through httpx.MockTransport, the DB through a fake store.
"""

from typing import Any

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.books import providers
from app.books.isbn import InvalidISBNError, isbn13_to_isbn10, normalise_isbn
from app.books.library import Library, LibraryError, LibraryErrorReason
from app.books.providers import BookMetadata, BookMetadataClient, ProviderError
from app.db.models import Book
from app.main import app
from app.routers.books import get_library

PRIDE = "9780141439518"  # Pride and Prejudice, Penguin Classics


# --- ISBN parsing ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw",
    [PRIDE, "978-0-14-143951-8", " 978 0141 439518 ", "0141439513", "0-14-143951-3",
     PRIDE + "51299", PRIDE + "12"],
)  # fmt: skip
def test_normalises_barcodes_and_isbns(raw: str) -> None:
    assert normalise_isbn(raw) == PRIDE


@pytest.mark.parametrize(
    "raw",
    ["9780141439519", "0141439514", "5012345678900", "12345", "hello world", "97801414395"],
)
def test_rejects_invalid_or_non_book_barcodes(raw: str) -> None:
    with pytest.raises(InvalidISBNError):
        normalise_isbn(raw)


def test_isbn10_with_x_check_digit() -> None:
    assert normalise_isbn("080442957X") == "9780804429573"
    assert isbn13_to_isbn10("9780804429573") == "080442957X"
    assert isbn13_to_isbn10("9791032305690") is None  # 979 ISBNs have no ISBN-10


# --- metadata providers ----------------------------------------------------------------------


def _google_item(isbn: str = PRIDE, title: str = "Pride and Prejudice") -> dict[str, Any]:
    return {
        "volumeInfo": {
            "title": title,
            "authors": ["Jane Austen"],
            "publishedDate": "2003-01-30",
            "language": "en",
            "categories": ["Fiction"],
            "industryIdentifiers": [{"type": "ISBN_13", "identifier": isbn}],
        }
    }


def _client(handler: Any, key: str = "") -> BookMetadataClient:
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return BookMetadataClient(http, google_api_key=key, timeout_seconds=1)


@pytest.fixture(autouse=True)
def _no_retry_delay(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(providers, "_RETRY_DELAY_SECONDS", 0)


async def test_google_books_lookup_maps_fields() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        near_miss = _google_item("9780000000002", "Pride and Prejudice: A Study Guide")
        return httpx.Response(200, json={"items": [near_miss, _google_item()]})

    found = await _client(handler, key="test-key").lookup(PRIDE)
    assert found == BookMetadata(
        isbn=PRIDE,
        title="Pride and Prejudice",  # the exact-ISBN record, not the study guide listed first
        author="Jane Austen",
        publication_year=2003,
        language="en",
        genre="Fiction",
        source="google_books",
    )
    assert seen[0].url.params["q"] == f"isbn:{PRIDE}"
    assert seen[0].url.params["key"] == "test-key"


async def test_falls_back_to_open_library_when_google_has_nothing() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "www.googleapis.com":
            return httpx.Response(200, json={"totalItems": 0})
        assert request.url.params["bibkeys"] == f"ISBN:{PRIDE}"
        edition = {
            "title": "Pride and Prejudice",
            "authors": [{"name": "Jane Austen"}],
            "publish_date": "January 30, 2003",
            "subjects": [{"name": "Courtship"}],
        }
        return httpx.Response(200, json={f"ISBN:{PRIDE}": edition})

    found = await _client(handler).lookup(PRIDE)
    assert found is not None
    assert (found.source, found.author, found.publication_year) == (
        "open_library",
        "Jane Austen",
        2003,
    )
    assert found.genre == "Courtship"


async def test_retries_google_once_on_503() -> None:
    calls = {"google": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["google"] += 1
        if calls["google"] == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"items": [_google_item()]})

    found = await _client(handler).lookup(PRIDE)
    assert found is not None and found.source == "google_books"
    assert calls["google"] == 2


async def test_google_key_error_falls_back_to_open_library() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "www.googleapis.com":
            return httpx.Response(403, json={"error": {"message": "API key not valid"}})
        return httpx.Response(200, json={f"ISBN:{PRIDE}": {"title": "Pride and Prejudice"}})

    found = await _client(handler, key="bad-key").lookup(PRIDE)
    assert found is not None and found.source == "open_library"


async def test_not_found_anywhere_returns_none() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"items": []})

    assert await _client(handler).lookup(PRIDE) is None


async def test_both_sources_down_raises_without_leaking_the_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    with pytest.raises(ProviderError) as exc:
        await _client(handler, key="secret-key-123").lookup(PRIDE)
    assert "secret-key-123" not in str(exc.value)


# --- library (DB + metadata) -----------------------------------------------------------------


class FakeStore:
    def __init__(self) -> None:
        self.books: dict[int, Book] = {}

    async def get(self, book_id: int) -> Book | None:
        return self.books.get(book_id)

    async def get_by_isbn(self, isbn: str) -> Book | None:
        return next((b for b in self.books.values() if b.isbn == isbn), None)

    async def add(self, book: Book) -> Book:
        book.id = len(self.books) + 1
        self.books[book.id] = book
        return book


class FakeMetadata:
    def __init__(self, result: BookMetadata | None | Exception) -> None:
        self.result = result
        self.calls = 0

    async def lookup(self, isbn13: str) -> BookMetadata | None:
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


PRIDE_META = BookMetadata(PRIDE, "Pride and Prejudice", "Jane Austen", 2003, "en", "Fiction",
                          "google_books")  # fmt: skip


async def test_first_scan_fetches_and_saves_second_scan_is_cached() -> None:
    store, metadata = FakeStore(), FakeMetadata(PRIDE_META)
    library = Library(store, metadata)

    first = await library.identify_by_isbn("0-14-143951-3")
    assert not first.cached
    assert (first.book.isbn, first.book.metadata_source) == (PRIDE, "google_books")

    second = await library.identify_by_isbn(PRIDE)
    assert second.cached and second.book.id == first.book.id
    assert metadata.calls == 1  # no external call for a book already in the library


@pytest.mark.parametrize(
    ("raw", "result", "reason"),
    [
        ("5012345678900", PRIDE_META, LibraryErrorReason.INVALID_ISBN),
        (PRIDE, None, LibraryErrorReason.NOT_FOUND),
        (PRIDE, ProviderError("down"), LibraryErrorReason.UNAVAILABLE),
    ],
)
async def test_library_errors(raw: str, result: Any, reason: LibraryErrorReason) -> None:
    with pytest.raises(LibraryError) as exc:
        await Library(FakeStore(), FakeMetadata(result)).identify_by_isbn(raw)
    assert exc.value.reason is reason


# --- endpoints -------------------------------------------------------------------------------


@pytest.fixture
def library() -> Library:
    lib = Library(FakeStore(), FakeMetadata(PRIDE_META))
    app.dependency_overrides[get_library] = lambda: lib
    yield lib
    app.dependency_overrides.clear()


def _http() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_identify_then_get_book(library: Library) -> None:
    async with _http() as client:
        first = await client.post("/books/identify", json={"isbn": "978-0-14-143951-8"})
        again = await client.post("/books/identify", json={"isbn": PRIDE})
        book_id = first.json()["id"]
        fetched = await client.get(f"/books/{book_id}")

    assert first.status_code == 200
    body = first.json()
    assert body["title"] == "Pride and Prejudice" and body["author"] == "Jane Austen"
    assert body["isbn"] == PRIDE and body["cached"] is False
    assert again.json()["cached"] is True
    assert fetched.status_code == 200 and fetched.json()["title"] == "Pride and Prejudice"
    assert "cached" not in fetched.json()


@pytest.mark.parametrize(
    ("isbn", "status"), [("5012345678900", 422), ("9780141439519", 422), ("123", 422)]
)
async def test_identify_rejects_bad_barcodes(library: Library, isbn: str, status: int) -> None:
    async with _http() as client:
        response = await client.post("/books/identify", json={"isbn": isbn})
    assert response.status_code == status


async def test_identify_not_found_and_unavailable() -> None:
    for result, status in ((None, 404), (ProviderError("down"), 503)):
        app.dependency_overrides[get_library] = lambda r=result: Library(
            FakeStore(), FakeMetadata(r)
        )
        async with _http() as client:
            response = await client.post("/books/identify", json={"isbn": PRIDE})
        assert response.status_code == status
    app.dependency_overrides.clear()


async def test_unknown_book_id_is_404(library: Library) -> None:
    async with _http() as client:
        response = await client.get("/books/999")
    assert response.status_code == 404
