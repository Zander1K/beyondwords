"""Settings loaded from environment variables (and `.env` for local runs).

Owner: Mick Ola (architecture). `APP_NAME` is the single place to rename the app.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    app_name: str = "Beyond Words"
    log_level: str = "INFO"

    database_url: str = "mysql+aiomysql://reading:reading@127.0.0.1:3306/reading_companion"

    # OPEN QUESTION: final set of provider names accepted by brain/llm.py.
    llm_provider: str = "nemotron"
    nemotron_base_url: str = ""
    nemotron_api_key: str = ""
    nemotron_model: str = "nemotron-3.5-super-vl"
    nemotron_timeout_s: float = 60.0
    nvidia_build_api_key: str = ""
    gemini_api_key: str = ""

    # Browser origins allowed to call the API (CORS) and open the /live WebSocket.
    # Comma-separated. Default: the web app's Vite dev server.
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    # TODO(Mick Ola): feature flags (e.g. illustrations, fading assist) once the SOP defines them.


@lru_cache
def get_settings() -> Settings:
    return Settings()
