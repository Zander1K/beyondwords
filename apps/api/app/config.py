"""Settings loaded from environment variables (and `.env` for local runs).

Owner: Mick Ola (architecture). `APP_NAME` is the single place to rename the app.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    app_name: str = "Reading Companion"
    log_level: str = "INFO"

    database_url: str = "postgresql+asyncpg://reading:reading@127.0.0.1:5432/reading_companion"

    # OPEN QUESTION: final set of provider names accepted by brain/llm.py.
    llm_provider: str = "nemotron"
    nemotron_base_url: str = ""
    nemotron_api_key: str = ""
    nvidia_build_api_key: str = ""
    gemini_api_key: str = ""

    # TODO(Mick Ola): feature flags (e.g. illustrations, fading assist) once the SOP defines them.


@lru_cache
def get_settings() -> Settings:
    return Settings()
