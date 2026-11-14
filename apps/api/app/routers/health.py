"""Liveness/readiness endpoint."""

from fastapi import APIRouter

from app.config import get_settings
from app.db.session import ping_database
from app.schemas.health import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    # The API stays up when the DB is down (graceful degradation); the status reports it.
    db_ok = await ping_database()
    return HealthResponse(
        status="ok",
        app=get_settings().app_name,
        database="ok" if db_ok else "unavailable",
    )
