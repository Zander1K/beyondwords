"""Public book metadata lookups by ISBN: Google Books first, Open Library as the keyless fallback.

Same approach as Scholia's `GoogleBooksService.searchByISBN`: `q=isbn:<isbn>` against Google
Books, an 8 s timeout, one retry on a 5xx (Google's frequent transient 503s), then Open Library.
Unlike Scholia's fallback (search.json, which returns the WORK), the Open Library call here is the
per-ISBN edition endpoint, so the title and year are those printed on the copy that was scanned.
Only metadata is read; no book text is fetched or stored.
"""

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx

from app.books.isbn import InvalidISBNError, isbn13_to_isbn10, normalise_isbn

logger = logging.getLogger(__name__)

GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes"
OPEN_LIBRARY_BOOKS_URL = "https://openlibrary.org/api/books"
OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json"
_RETRY_DELAY_SECONDS = 0.35


class ProviderError(Exception):
    """A metadata source could not be reached or answered with an error."""


@dataclass(frozen=True)
class BookMetadata:
    isbn: str
    title: str
    author: str | None
    publication_year: int | None
    language: str | None
    genre: str | None
    source: str  # "google_books" | "open_library" -> books.metadata_source


def _year(value: Any) -> int | None:
    # "2003", "2003-01-30" (Google) or "January 30, 2003" (Open Library).
    match = re.search(r"\b(1[4-9]\d\d|20\d\d)\b", str(value)) if value is not None else None
    return int(match.group(1)) if match else None


def _first_isbn13(candidates: list[str]) -> str | None:
    """The first valid ISBN in a list (10- or 13-digit), as an ISBN-13."""
    for raw in candidates:
        try:
            return normalise_isbn(str(raw))
        except InvalidISBNError:
            continue
    return None


def _clip(value: str | None, limit: int) -> str | None:
    if not value:
        return None
    value = " ".join(value.split())
    return value[:limit] if value else None


class BookMetadataClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        google_api_key: str = "",
        timeout_seconds: float = 8.0,
    ) -> None:
        self._http = http
        self._google_key = google_api_key
        self._timeout = timeout_seconds

    async def lookup(self, isbn13: str) -> BookMetadata | None:
        """Google Books, then Open Library. None if neither knows the ISBN.

        Raises ProviderError only if both sources failed (so "not found" and "unavailable"
        stay distinguishable for the caller).
        """
        errors: list[str] = []
        for name, source in (("google_books", self._google), ("open_library", self._open_library)):
            try:
                found = await source(isbn13)
            except ProviderError as exc:
                logger.warning("Book lookup via %s failed: %s", name, exc)
                errors.append(f"{name}: {exc}")
                continue
            if found is not None:
                return found
        if len(errors) == 2:
            raise ProviderError("; ".join(errors))
        return None

    async def search(self, title: str, author: str | None = None) -> BookMetadata | None:
        """Find a book by what is printed on its cover when its ISBN could not be read.

        Google Books, then Open Library; the first match that carries an ISBN-13 (so the book can
        then be stored and recognised like any scanned one). None if neither finds one. Raises
        ProviderError only if both sources failed.
        """
        errors: list[str] = []
        for name, source in (
            ("google_books", self._google_search),
            ("open_library", self._open_library_search),
        ):
            try:
                found = await source(title, author)
            except ProviderError as exc:
                logger.warning("Book search via %s failed: %s", name, exc)
                errors.append(f"{name}: {exc}")
                continue
            if found is not None:
                return found
        if len(errors) == 2:
            raise ProviderError("; ".join(errors))
        return None

    async def _google_search(self, title: str, author: str | None) -> BookMetadata | None:
        query = f'intitle:"{title}"' + (f'+inauthor:"{author}"' if author else "")
        params = {"q": query, "printType": "books", "maxResults": "5"}
        if self._google_key:
            params["key"] = self._google_key
        data = await self._get_json(GOOGLE_BOOKS_URL, params)
        for item in data.get("items") or []:
            info = item.get("volumeInfo") or {}
            isbn = next(
                (
                    i.get("identifier")
                    for i in info.get("industryIdentifiers") or []
                    if i.get("type") == "ISBN_13" and i.get("identifier")
                ),
                None,
            )
            name = " ".join(t for t in (info.get("title"), info.get("subtitle")) if t)
            if not isbn or not name:
                continue
            return BookMetadata(
                isbn=isbn,
                title=_clip(name, 512) or name,
                author=_clip(", ".join(info.get("authors") or []), 512),
                publication_year=_year(info.get("publishedDate")),
                language=_clip(info.get("language"), 16),
                genre=_clip((info.get("categories") or [None])[0], 128),
                source="google_books",
            )
        return None

    async def _open_library_search(self, title: str, author: str | None) -> BookMetadata | None:
        params = {
            "title": title,
            "limit": "5",
            "fields": "title,author_name,first_publish_year,isbn,language,subject",
        }
        if author:
            params["author"] = author
        data = await self._get_json(OPEN_LIBRARY_SEARCH_URL, params)
        for doc in data.get("docs") or []:
            isbn = _first_isbn13(doc.get("isbn") or [])
            if not isbn or not doc.get("title"):
                continue
            return BookMetadata(
                isbn=isbn,
                title=_clip(doc["title"], 512) or doc["title"],
                author=_clip(", ".join(doc.get("author_name") or []), 512),
                # The WORK's first year, which is the era a reader's context needs.
                publication_year=_year(doc.get("first_publish_year")),
                language=_clip((doc.get("language") or [None])[0], 16),
                genre=_clip((doc.get("subject") or [None])[0], 128),
                source="open_library",
            )
        return None

    async def _get_json(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        """GET with the per-call timeout and one retry on a 5xx or network error."""
        for attempt in range(2):
            try:
                response = await self._http.get(url, params=params, timeout=self._timeout)
            except httpx.HTTPError as exc:
                if attempt == 0:
                    await asyncio.sleep(_RETRY_DELAY_SECONDS)
                    continue
                raise ProviderError(type(exc).__name__) from exc
            if response.status_code == 200:
                return response.json()
            if response.status_code >= 500 and attempt == 0:
                await asyncio.sleep(_RETRY_DELAY_SECONDS)
                continue
            # 4xx: bad key, quota (429) or bad request. Never include the URL: it holds the key.
            raise ProviderError(f"HTTP {response.status_code}")
        raise ProviderError("no response")

    async def _google(self, isbn13: str) -> BookMetadata | None:
        params = {"q": f"isbn:{isbn13}", "printType": "books", "maxResults": "5"}
        if self._google_key:
            params["key"] = self._google_key
        data = await self._get_json(GOOGLE_BOOKS_URL, params)

        items = data.get("items") or []
        wanted = {isbn13, isbn13_to_isbn10(isbn13)}
        # Prefer the record that actually carries this ISBN; Google sometimes adds near matches.
        exact = [
            item
            for item in items
            if wanted
            & {
                ident.get("identifier")
                for ident in item.get("volumeInfo", {}).get("industryIdentifiers") or []
            }
        ]
        for item in exact or items:
            info = item.get("volumeInfo") or {}
            title = " ".join(t for t in (info.get("title"), info.get("subtitle")) if t)
            if not title:
                continue
            return BookMetadata(
                isbn=isbn13,
                title=_clip(title, 512) or title,
                author=_clip(", ".join(info.get("authors") or []), 512),
                # Google gives the EDITION's date. OPEN QUESTION: for era context the original
                # publication year may matter more (SOP 8.5 "Tory" example).
                publication_year=_year(info.get("publishedDate")),
                language=_clip(info.get("language"), 16),
                genre=_clip((info.get("categories") or [None])[0], 128),
                source="google_books",
            )
        return None

    async def _open_library(self, isbn13: str) -> BookMetadata | None:
        bibkey = f"ISBN:{isbn13}"
        params = {"bibkeys": bibkey, "format": "json", "jscmd": "data"}
        data = await self._get_json(OPEN_LIBRARY_BOOKS_URL, params)
        edition = data.get(bibkey) or {}
        if not edition.get("title"):
            return None
        title = " ".join(t for t in (edition.get("title"), edition.get("subtitle")) if t)
        authors = [a.get("name") for a in edition.get("authors") or [] if a.get("name")]
        subjects = [s.get("name") for s in edition.get("subjects") or [] if s.get("name")]
        return BookMetadata(
            isbn=isbn13,
            title=_clip(title, 512) or title,
            # Author names use Open Library's own spelling (e.g. "Fiódor Dostoievski").
            author=_clip(", ".join(authors), 512),
            publication_year=_year(edition.get("publish_date")),  # this edition's year
            language=None,  # not returned by this endpoint
            genre=_clip(subjects[0] if subjects else None, 128),
            source="open_library",
        )
