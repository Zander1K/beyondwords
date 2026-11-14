"""Request ids and last-resort error handling (CLAUDE.md section 9).

Every request gets an `X-Request-ID` (taken from the client if sent, else generated). It is
returned in the response headers, added to every log line, and included in error bodies so a
failure seen in the web app can be found in the API logs.
"""

import logging
import uuid
from contextvars import ContextVar

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

REQUEST_ID_HEADER = "X-Request-ID"

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")
logger = logging.getLogger(__name__)


class RequestIdFilter(logging.Filter):
    """Adds `request_id` to every log record so the log format can print it."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        request.state.request_id = request_id
        token = request_id_var.set(request_id)
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers[REQUEST_ID_HEADER] = request_id
        return response


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Log with the request id and return JSON instead of a bare 500, so the client can show a
    # subtle status and keep the reading session alive.
    # This handler runs outside RequestIdMiddleware, so read the id from request.state.
    request_id = getattr(request.state, "request_id", None) or uuid.uuid4().hex
    token = request_id_var.set(request_id)
    try:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    finally:
        request_id_var.reset(token)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": request_id},
        headers={REQUEST_ID_HEADER: request_id},
    )


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.addFilter(RequestIdFilter())
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s")
    )
    logging.basicConfig(level=level.upper(), handlers=[handler], force=True)


def is_origin_allowed(origin: str | None, allowed: list[str]) -> bool:
    """Origin check for WebSockets, which CORSMiddleware does not cover.

    Browsers send `Origin` on WebSocket handshakes but do not enforce CORS on them, so `/live`
    must check it itself. A missing Origin means a non-browser client (tests, scripts): allow it.
    """
    if origin is None:
        return True
    return origin.rstrip("/") in allowed


def install(app: FastAPI, cors_origins: list[str] | None = None) -> None:
    app.add_middleware(RequestIdMiddleware)
    if cors_origins:
        # Added last, so it runs first: preflight requests are answered before anything else.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_methods=["*"],
            allow_headers=["*"],
            # Lets the web app read the request id for error reports (CLAUDE.md section 9).
            expose_headers=[REQUEST_ID_HEADER],
        )
    app.add_exception_handler(Exception, unhandled_exception_handler)
