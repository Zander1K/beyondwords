from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient

from app.config import Settings, get_settings
from app.main import app
from app.middleware import is_origin_allowed

# The web app origin the running app is configured to allow (CORS_ORIGINS in .env, default
# http://localhost:5173), so the tests do not depend on which port a developer chose.
WEB_ORIGIN = get_settings().cors_origin_list[0]


async def test_preflight_from_web_dev_origin_is_allowed() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.options(
            "/health",
            headers={"Origin": WEB_ORIGIN, "Access-Control-Request-Method": "GET"},
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == WEB_ORIGIN


async def test_health_from_web_origin_has_cors_headers() -> None:
    with patch("app.routers.health.ping_database", AsyncMock(return_value=True)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/health", headers={"Origin": WEB_ORIGIN})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == WEB_ORIGIN
    assert "X-Request-ID" in response.headers["access-control-expose-headers"]


async def test_unknown_origin_gets_no_cors_headers() -> None:
    with patch("app.routers.health.ping_database", AsyncMock(return_value=True)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in response.headers


def test_cors_origins_parses_comma_separated_list() -> None:
    settings = Settings(cors_origins=" http://localhost:5173/ , https://abc.ngrok.app ,")
    assert settings.cors_origin_list == ["http://localhost:5173", "https://abc.ngrok.app"]


def test_websocket_origin_check() -> None:
    allowed = [WEB_ORIGIN]
    assert is_origin_allowed(WEB_ORIGIN, allowed)
    assert is_origin_allowed(WEB_ORIGIN + "/", allowed)
    assert not is_origin_allowed("https://evil.example", allowed)
    assert is_origin_allowed(None, allowed)  # non-browser clients send no Origin
