"""Turn whatever a barcode scanner returns into one canonical ISBN-13.

A book's barcode is an EAN-13 starting 978 or 979, which is its ISBN-13. Scanners may also
return an old ISBN-10, hyphens and spaces, or a 2/5-digit price add-on after the main code.
An ISBN names one printing, so it identifies the exact edition the reader is holding.
"""

import re


class InvalidISBNError(ValueError):
    """The scanned value is not a valid book ISBN."""


def _isbn13_check_digit(first12: str) -> str:
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(first12))
    return str((10 - total % 10) % 10)


def _isbn10_is_valid(isbn10: str) -> bool:
    total = 0
    for i, ch in enumerate(isbn10):
        value = 10 if ch == "X" else int(ch)
        total += value * (10 - i)
    return total % 11 == 0


def normalise_isbn(raw: str) -> str:
    """Return the ISBN-13 for a scanned barcode or typed ISBN, or raise InvalidISBNError."""
    code = re.sub(r"[\s\-]", "", raw.strip().upper())
    if not re.fullmatch(r"\d{9}[\dX]|\d{13}|\d{15}|\d{18}", code):
        raise InvalidISBNError("expected a 10- or 13-digit ISBN from the book's barcode")

    if len(code) == 10:
        if not _isbn10_is_valid(code):
            raise InvalidISBNError("ISBN-10 check digit does not match")
        first12 = "978" + code[:9]
        return first12 + _isbn13_check_digit(first12)

    # Drop a 2- or 5-digit EAN add-on (price or issue number) after the main barcode.
    code = code[:13]
    if not code.startswith(("978", "979")):
        raise InvalidISBNError("this barcode is not a book (books start with 978 or 979)")
    if _isbn13_check_digit(code[:12]) != code[12]:
        raise InvalidISBNError("ISBN-13 check digit does not match")
    return code


def isbn13_to_isbn10(isbn13: str) -> str | None:
    """ISBN-10 form of a 978 ISBN-13 (some catalogues only index the old form)."""
    if not isbn13.startswith("978"):
        return None
    core = isbn13[3:12]
    total = sum(int(d) * (10 - i) for i, d in enumerate(core))
    check = (11 - total % 11) % 11
    return core + ("X" if check == 10 else str(check))
