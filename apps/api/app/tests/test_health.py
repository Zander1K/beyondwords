from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import app


async def _get_health() -> dict:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    return response.json()


async def test_health_ok_when_database_reachable() -> None:
    with patch("app.routers.health.ping_database", AsyncMock(return_value=True)):
        body = await _get_health()
    assert body == {"status": "ok", "app": get_settings().app_name, "database": "ok"}


async def test_health_stays_up_when_database_down() -> None:
    with patch("app.routers.health.ping_database", AsyncMock(return_value=False)):
        body = await _get_health()
    assert body["status"] == "ok"
    assert body["database"] == "unavailable"
