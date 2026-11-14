"""Reader identity: a username only, no password or email (team decision 2026-11-14)."""

import re
from typing import Literal

from pydantic import BaseModel, Field

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


class Spacing(BaseModel):
    """Reading comfort settings (CLAUDE.md section 8). Ranges match the web Settings sliders."""

    letter_spacing: float = Field(ge=0, le=0.3, description="em")
    word_spacing: float = Field(ge=0, le=0.8, description="em")
    line_height: float = Field(ge=1.2, le=2.6, description="multiple of the font size")
    font_size: float = Field(ge=0.875, le=1.75, description="rem")


class OnboardingRequest(BaseModel):
    """What a new reader tells us at setup (SOP 7.1). Re-sending it updates the answers."""

    support_level: Literal["listen", "read_along", "solo"] = Field(
        description="How much help to start with. Read-along is the default."
    )
    glasses_type: Literal["display", "gen2"] | None = Field(
        default=None, description="Null when they have no glasses yet (web demo)."
    )
    display_name: str | None = Field(default=None, max_length=64)
    spacing: Spacing | None = None


class Profile(BaseModel):
    """The reader as the app needs them."""

    id: int
    username: str = Field(description="As stored: trimmed and lowercased.")
    display_name: str | None = None
    support_level: str
    glasses_type: str | None = None
    voice: str | None = None
    spacing: Spacing | None = None
    onboarded: bool = Field(description="False for a reader who has not done setup yet.")


class LoginRequest(BaseModel):
    username: str = Field(max_length=64, examples=["ada_l"])


class LoginResponse(Profile):
    created: bool = Field(description="True when this request created the reader.")
