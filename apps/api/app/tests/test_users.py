import pytest

from app.schemas.users import InvalidUsernameError, normalize_username


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("Mick", "mick"), ("  mick_ola  ", "mick_ola"), ("reader.42", "reader.42"), ("a-b", "a-b")],
)
def test_normalize_username_lowercases_and_trims(raw: str, expected: str) -> None:
    assert normalize_username(raw) == expected


@pytest.mark.parametrize("raw", ["", "ab", "x" * 33, "mick ola", "_mick", "mick!", "mïck"])
def test_normalize_username_rejects_bad_names(raw: str) -> None:
    with pytest.raises(InvalidUsernameError):
        normalize_username(raw)
