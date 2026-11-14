"""Reader identity: a username only, no password or email (team decision 2026-11-14)."""

import re

USERNAME_MIN = 3
USERNAME_MAX = 32
_USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]*$")


class InvalidUsernameError(ValueError):
    """The username is empty, too long or uses characters we do not allow."""


def normalize_username(raw: str) -> str:
    """Trim and lowercase, then check: 3-32 chars of a-z, 0-9, `_`, `.`, `-`.

    Usernames are stored in this form, so lookups are case-insensitive.
    """
    username = raw.strip().lower()
    if not USERNAME_MIN <= len(username) <= USERNAME_MAX:
        raise InvalidUsernameError(f"Username must be {USERNAME_MIN} to {USERNAME_MAX} characters.")
    if not _USERNAME_RE.match(username):
        raise InvalidUsernameError(
            "Username can use letters, numbers, '_', '.' and '-', and must start with a "
            "letter or number."
        )
    return username
