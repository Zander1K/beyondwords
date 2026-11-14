"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from app import middleware
from app.config import get_settings
from app.routers import ask, books, health, illustrations, speech, users, words

settings = get_settings()
middleware.configure_logging(settings.log_level)

app = FastAPI(title=settings.app_name, version="0.1.0")
# Request ids, JSON 500s and CORS for the web app (middleware.py, from Alex's branch).
middleware.install(app, cors_origins=settings.cors_origin_list)
app.include_router(health.router)
app.include_router(ask.router)
app.include_router(books.router)
app.include_router(illustrations.router)
app.include_router(speech.router)
app.include_router(users.router)
app.include_router(words.router)

# TODO(Matthew/Mick Ola): include pages and progress routers once the contracts
# (build order step 2) are agreed.


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    # Opening the base URL in a browser lands on the interactive docs.
    return RedirectResponse(url="/docs")
