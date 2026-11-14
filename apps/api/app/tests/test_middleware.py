from unittest.mock import AsyncMock, patch

from fastapi import APIRouter, FastAPI
from httpx import ASGITransport, AsyncClient

from app import middleware
from app.main import app


async def test_request_id_is_generated_and_returned() -> None:
    with patch("app.routers.health.ping_database", AsyncMock(return_value=True)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/health")
    assert response.headers[middleware.REQUEST_ID_HEADER]


async def test_client_request_id_is_echoed() -> None:
    with patch("app.routers.health.ping_database", AsyncMock(return_value=True)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/health", headers={"X-Request-ID": "abc123"})
    assert response.headers[middleware.REQUEST_ID_HEADER] == "abc123"


async def test_unhandled_error_returns_json_with_request_id() -> None:
    broken = FastAPI()
    middleware.install(broken)
    router = APIRouter()

    @router.get("/boom")
    async def boom() -> None:
        raise RuntimeError("boom")

    broken.include_router(router)
    transport = ASGITransport(app=broken, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/boom", headers={"X-Request-ID": "req-1"})
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error", "request_id": "req-1"}


async def test_root_redirects_to_docs() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/")
    assert response.status_code == 307
    assert response.headers["location"] == "/docs"
