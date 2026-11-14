"""POST /users/login: the reader's whole sign-in is a username (team decision 2026-11-14).

Gets the reader, or creates a new one the first time the name is used. No password or email:
the web app's shared access password is only a courtesy gate in the browser.
HACK: anyone who types a username gets that reader's progress (see db/models.py:User).
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.repositories.users import complete_onboarding, get_or_create_user, to_profile
from app.db.session import get_session
from app.schemas.users import (
    InvalidUsernameError,
    LoginRequest,
    LoginResponse,
    OnboardingRequest,
    Profile,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest, session: Annotated[AsyncSession, Depends(get_session)]
) -> LoginResponse:
    try:
        user, created = await get_or_create_user(session, body.username)
    except InvalidUsernameError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except (SQLAlchemyError, OSError) as exc:
        logger.warning("User lookup failed", exc_info=True)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The user database is unavailable."
        ) from exc
    return LoginResponse(**to_profile(user).model_dump(), created=created)


@router.put("/{user_id}/onboarding", response_model=Profile)
async def save_onboarding(
    user_id: int,
    body: OnboardingRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Profile:
    """First-run setup: starting support level, glasses, comfort spacing, an optional name."""
    try:
        user = await complete_onboarding(session, user_id, body)
    except (SQLAlchemyError, OSError) as exc:
        logger.warning("Saving onboarding failed", exc_info=True)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The user database is unavailable."
        ) from exc
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reader not found")
    return to_profile(user)
