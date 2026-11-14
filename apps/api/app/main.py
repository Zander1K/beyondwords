"""FastAPI application entry point."""

import logging

from fastapi import FastAPI

from app.config import get_settings
from app.routers import health

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper())

app = FastAPI(title=settings.app_name, version="0.1.0")
app.include_router(health.router)

# TODO(Matthew/Mick Ola): include books, pages, words, progress and live routers once
# the contracts (build order step 2) are agreed.
