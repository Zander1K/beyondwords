"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from app import middleware
from app.config import get_settings
from app.routers import health

settings = get_settings()
middleware.configure_logging(settings.log_level)

app = FastAPI(title=settings.app_name, version="0.1.0")
middleware.install(app, cors_origins=settings.cors_origin_list)
app.include_router(health.router)

# TODO(Matthew/Mick Ola): include books, pages, words, progress and live routers once
# the contracts (build order step 2) are agreed.


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    # Opening the base URL in a browser lands on the interactive docs.
    return RedirectResponse(url="/docs")
