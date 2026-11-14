"""Users by username: the app's whole sign-in (no passwords).

OPEN QUESTION: the HTTP endpoint the phone calls (e.g. `POST /users` with `{"username"}`)
is not in SOP section 5 yet; agree it with Alex before adding the router.
"""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User
from app.schemas.users import normalize_username


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
