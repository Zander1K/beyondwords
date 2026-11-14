"""Swappable model interface (Nemotron, Gemini, Muse Spark stub).

Every model call goes through here so providers can be swapped, logged and rate-limited
in one place. Callers use `get_llm()` and never import a provider module directly.

    llm = get_llm()
    reply = await llm.chat([Message(role="user", content="Hello")])
    reply.text

TODO(Matthew): rate limiting / queueing (NVIDIA Build fallback ~40 req/min/key) and
caching page analyses by image hash (CLAUDE.md section 9).
"""

import base64
import logging
import time
from functools import lru_cache
from typing import Any, Literal, Protocol

from pydantic import BaseModel

from app.config import get_settings

logger = logging.getLogger(__name__)

# OpenAI-style content: a plain string, or a list of parts (text and images) for VL models.
Content = str | list[dict[str, Any]]


class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: Content


class LLMResponse(BaseModel):
    text: str
    # Nemotron returns its chain of thought separately. Log/debug only; never show it to users.
    reasoning: str | None = None
    model: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    latency_ms: int


class LLMError(RuntimeError):
    """Provider unreachable, timed out or returned an error. Callers should degrade gracefully."""


class LLMClient(Protocol):
    name: str

    async def chat(
        self,
        messages: list[Message],
        *,
        max_tokens: int = 1024,
        temperature: float = 0.2,
        reasoning: bool = True,
    ) -> LLMResponse: ...


def text_part(text: str) -> dict[str, Any]:
    return {"type": "text", "text": text}


def image_part(image: bytes, mime: str = "image/jpeg") -> dict[str, Any]:
    """Inline image for VL models. The image is sent to the provider, never stored."""
    data = base64.b64encode(image).decode()
    return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data}"}}


class _LoggedClient:
    """Wraps a provider so every call is timed and logged in one place."""

    def __init__(self, inner: LLMClient) -> None:
        self._inner = inner
        self.name = inner.name

    async def chat(self, messages: list[Message], **kwargs: Any) -> LLMResponse:
        start = time.perf_counter()
        try:
            reply = await self._inner.chat(messages, **kwargs)
        except LLMError:
            logger.warning(
                "LLM call failed provider=%s after %dms",
                self.name,
                (time.perf_counter() - start) * 1000,
                exc_info=True,
            )
            raise
        logger.info(
            "LLM call provider=%s model=%s latency_ms=%d tokens_in=%s tokens_out=%s",
            self.name,
            reply.model,
            reply.latency_ms,
            reply.prompt_tokens,
            reply.completion_tokens,
        )
        return reply


@lru_cache
def get_llm() -> LLMClient:
    # OPEN QUESTION: final provider set (nemotron | nvidia_build | gemini | muse_spark).
    provider = get_settings().llm_provider
    if provider == "nemotron":
        from app.brain.nemotron import NemotronClient

        return _LoggedClient(NemotronClient())
    raise ValueError(f"Unsupported LLM_PROVIDER={provider!r}")
