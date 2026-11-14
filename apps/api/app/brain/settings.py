"""Brain-only settings (Owner: Matthew).

Kept separate from `app/config.py` (Mick Ola's) so brain tuning never needs a change outside
`brain/`. Connection settings (NEMOTRON_BASE_URL, NEMOTRON_API_KEY, NEMOTRON_MODEL,
NVIDIA_BUILD_API_KEY, LLM_PROVIDER) still come from `app.config`.

Every value has a safe default, so nothing new is required in `.env`.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class BrainSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"), env_prefix="BRAIN_", extra="ignore"
    )

    # Per-call timeouts (seconds). SOP section 9: 8 s per call for anything the reader waits on.
    # Page analysis runs in the background while phone OCR + TTS already read aloud, so it may
    # take longer.
    ask_timeout_s: float = 8.0
    page_timeout_s: float = 30.0
    document_timeout_s: float = 15.0
    # Reading a book from a photo, and giving a new book its background: one-off, so patient.
    cover_timeout_s: float = 45.0

    # Retries: SOP section 9 says exponential backoff, at most 3 attempts.
    max_attempts: int = 3
    backoff_base_s: float = 0.5

    # Cap concurrent Nemotron calls so the demo never queues behind test runs (SOP section 9).
    max_concurrency: int = 6

    # Thinking pass on/off per job. Off is much faster; turn on if eval numbers improve enough.
    page_reasoning: bool = False
    ask_reasoning: bool = False
    document_reasoning: bool = False

    # Agent: SOP section 8.2 loop limit.
    agent_max_tool_steps: int = 4

    # Hard words below this model confidence are dropped rather than shown to the reader.
    min_hard_word_confidence: float = 0.6

    # Page-analysis cache (in memory, keyed by image hash). Images themselves are never kept.
    page_cache_size: int = 256

    # NVIDIA Build fallback (SOP 8.6). ~40 req/min/key on the free tier; cap at 35.
    # OPEN QUESTION: exact model id on NVIDIA Build for Nemotron 3.5 Super VL (ask NVIDIA mentors).
    nvidia_build_base_url: str = "https://integrate.api.nvidia.com/v1"
    nvidia_build_model: str = "nvidia/nemotron-3.5-super-vl"
    nvidia_build_rpm: int = 35


@lru_cache
def get_brain_settings() -> BrainSettings:
    return BrainSettings()
