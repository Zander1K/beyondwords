"""FastAPI application entry point."""

import logging

from fastapi import FastAPI

from app.config import get_settings
from app.routers import ask, books, health, illustrations

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper())

app = FastAPI(title=settings.app_name, version="0.1.0")
app.include_router(health.router)
app.include_router(ask.router)
app.include_router(books.router)
app.include_router(illustrations.router)

# TODO(Matthew/Mick Ola): include pages, words and progress routers once the contracts
# (build order step 2) are agreed.
