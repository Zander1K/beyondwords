"""Settings loaded from environment variables (and `.env` for local runs).

Owner: Mick Ola (architecture). `APP_NAME` is the single place to rename the app.
"""

from functools import lru_cache
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# libpq query options asyncpg does not understand. Aiven Runtime's injected DATABASE_URL adds them.
_LIBPQ_ONLY_PARAMS = {"uselibpqcompat"}


def to_asyncpg_url(url: str) -> str:
    """Accept a plain PostgreSQL URI (e.g. Aiven's) and return the SQLAlchemy asyncpg form.

    `postgres://` / `postgresql://` become `postgresql+asyncpg://`, `sslmode=` becomes asyncpg's
    `ssl=`, and libpq-only options are dropped. Other URLs (e.g. sqlite in tests) pass through.
    """
    parts = urlsplit(url)
    if parts.scheme not in ("postgres", "postgresql", "postgresql+asyncpg"):
        return url
    query = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key in _LIBPQ_ONLY_PARAMS:
            continue
        query.append(("ssl" if key == "sslmode" else key, value))
    return urlunsplit(parts._replace(scheme="postgresql+asyncpg", query=urlencode(query)))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    app_name: str = "Reading Companion"
    log_level: str = "INFO"

    # Any PostgreSQL URI works: Aiven's postgresql://...?sslmode=require is converted for asyncpg.
    database_url: str = "postgresql+asyncpg://reading:reading@127.0.0.1:5432/reading_companion"

    @field_validator("database_url")
    @classmethod
    def _asyncpg_database_url(cls, value: str) -> str:
        return to_asyncpg_url(value)

    # OPEN QUESTION: final set of provider names accepted by brain/llm.py.
    llm_provider: str = "nemotron"
    nemotron_base_url: str = ""
    nemotron_api_key: str = ""
    nemotron_model: str = "nemotron-3.5-super-vl"
    nemotron_timeout_s: float = 60.0
    nvidia_build_api_key: str = ""
    gemini_api_key: str = ""
    # Model IDs (SOP 8.4 swappable model layer). See docs/gemini.md for why these defaults.
    # Text conversation behind POST /ask. Voice in and out stays on the phone (docs/gemini.md).
    gemini_chat_model: str = "gemini-4-hydrogen"
    # SOP section 9: 8 s per external call. Gemini can be called up to 5 times per question
    # (4 tool steps), each with its own timeout.
    gemini_chat_timeout_seconds: float = 8.0
    # How long ask_brain (Nemotron) may take before Gemini answers from the page text alone.
    brain_timeout_seconds: float = 8.0
    # Conversations are forgotten after this much idle time (transcripts never stored).
    conversation_ttl_seconds: float = 1800.0
    gemini_image_model: str = "gemini-3.1-flash-lite-image"
    # HACK: no latency figures published for image models yet; tune after measuring.
    gemini_image_timeout_seconds: float = 12.0
    # In-memory illustration cache size (images, not user data). Lost on restart.
    illustration_cache_size: int = 256
    # Scene planning before each new picture (app/gemini/scene_planner.py). On timeout the text is
    # drawn as given.
    illustration_plan_timeout_seconds: float = 8.0

    # Google Books API key for barcode/ISBN lookups. Optional: lookups work without a key at a
    # lower shared quota, and Open Library is the keyless fallback.
    google_books_api_key: str = ""
    # Per-request timeout for book metadata lookups (SOP section 9: 8 s per external call).
    book_lookup_timeout_seconds: float = 8.0

    # Browser origins allowed to call the API (CORS) and open the /live WebSocket.
    # Comma-separated. Default: the web app's Vite dev server. Same as Alex's ui-dat-development.
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    # TODO(Mick Ola): feature flags (e.g. illustrations, fading assist) once the SOP defines them.


@lru_cache
def get_settings() -> Settings:
    return Settings()
