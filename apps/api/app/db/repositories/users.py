"""Users by username: the app's whole sign-in (no passwords).

OPEN QUESTION: the HTTP endpoint the phone calls (e.g. `POST /users` with `{"username"}`)
is not in SOP section 5 yet; agree it with Alex before adding the router.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ReadingEvent, ReadingEventType, User
from app.schemas.users import OnboardingRequest, Profile, Spacing, normalize_username


async def get_user_by_username(session: AsyncSession, username: str) -> User | None:
    result = await session.execute(
        select(User).where(User.username == normalize_username(username))
    )
    return result.scalar_one_or_none()


async def get_or_create_user(session: AsyncSession, username: str) -> tuple[User, bool]:
    """Return (user, created). A new username makes a new reader with default settings.

    Raises InvalidUsernameError for a bad username. Commits when it creates a user.
    """
    name = normalize_username(username)
    user = await get_user_by_username(session, name)
    if user is not None:
        return user, False
    user = User(username=name)
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        # Two first-time requests for the same name raced; the other one won.
        await session.rollback()
        existing = await get_user_by_username(session, name)
        if existing is None:
            raise
        return existing, False
    await session.refresh(user)
    return user, True


ONBOARDING_VERSION = 1


def to_profile(user: User) -> Profile:
    """The reader as the app sees them. `onboarded` lives in `settings` (no extra column)."""
    settings = user.settings or {}
    spacing = settings.get("spacing")
    return Profile(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        support_level=user.support_level,
        glasses_type=user.glasses_type,
        voice=user.voice,
        spacing=Spacing(**spacing) if isinstance(spacing, dict) else None,
        onboarded=bool((settings.get("onboarding") or {}).get("completed_at")),
    )


async def complete_onboarding(
    session: AsyncSession, user_id: int, answers: OnboardingRequest
) -> User | None:
    """Save a reader's setup answers and mark them onboarded. None if there is no such reader.

    Also appends a `mode_changed` reading event with the starting support level, so progression
    and "support that fades" have a first data point (`from` is the level they had before; a
    repeat of onboarding records the change). Commits.
    """
    user = await session.get(User, user_id)
    if user is None:
        return None
    previous = user.support_level
    user.support_level = answers.support_level
    user.glasses_type = answers.glasses_type
    if answers.display_name is not None:
        user.display_name = answers.display_name.strip() or None
    # Assign a new dict: SQLAlchemy does not see changes made inside a JSON value.
    settings = dict(user.settings or {})
    if answers.spacing is not None:
        settings["spacing"] = answers.spacing.model_dump()
    settings["onboarding"] = {
        "completed_at": datetime.now(UTC).isoformat(),
        "version": ONBOARDING_VERSION,
    }
    user.settings = settings
    session.add(
        ReadingEvent(
            user_id=user.id,
            event_type=ReadingEventType.MODE_CHANGED.value,
            mode=answers.support_level,
            payload={"from": previous, "to": answers.support_level, "source": "onboarding"},
        )
    )
    await session.commit()
    await session.refresh(user)
    return user
