"""Request/response models for the book library (SOP section 5: /books/identify, /books/{id})."""

from pydantic import BaseModel, ConfigDict, Field


class IdentifyBookRequest(BaseModel):
    isbn: str = Field(
        min_length=10,
        max_length=32,
        description=(
            "The value read from the book's barcode (EAN-13 starting 978/979), or a typed ISBN-10 "
            "or ISBN-13. Hyphens, spaces and a price add-on after the barcode are accepted."
        ),
        examples=["9780141439518", "0-14-143951-3"],
    )


class BookResponse(BaseModel):
    """Book metadata only, never book text."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    isbn: str | None
    title: str
    author: str | None
    publication_year: int | None
    language: str | None = Field(description="BCP 47 tag, e.g. 'en'.")
    genre: str | None
    setting_era: str | None
    description_spoiler_free: str | None
    metadata_source: str | None = Field(description="'google_books' or 'open_library'.")


class IdentifyBookResponse(BookResponse):
    cached: bool = Field(
        description="True if the book was already in our library (no external lookup made)."
    )
