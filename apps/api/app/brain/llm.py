"""Swappable model interface (Nemotron, Gemini, Muse Spark stub).

Every model call goes through here so providers can be swapped, logged and rate-limited
in one place. Callers use `get_llm()` and never import a provider module directly.

    llm = get_llm()
    reply = await llm.chat([Message(role="user", content="Hello")])
    reply.text

What `get_llm()` returns (outermost first):

    _LoggedClient       times and logs every call (metadata only, never page text)
      _RetryingClient   SOP 9: exponential backoff, at most 3 attempts, on retryable errors
        _FallbackClient Verda first; NVIDIA Build if Verda fails (only if a key is set)
          _LimitedClient caps concurrency (Verda) or requests/minute (NVIDIA Build, 35)

`LLM_PROVIDER` values: `nemotron` (Verda, NVIDIA Build fallback if NVIDIA_BUILD_API_KEY is
set) or `nvidia_build` (NVIDIA Build only). Gemini and Muse Spark are not reasoning
providers in the SOP, so they are not accepted here.
"""

import asyncio
import base64
import logging
import time
from collections import deque
from functools import lru_cache
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field

from app.brain.settings import get_brain_settings
from app.config import get_settings

logger = logging.getLogger(__name__)

# OpenAI-style content: a plain string, or a list of parts (text and images) for VL models.
Content = str | list[dict[str, Any]]


class ToolCall(BaseModel):
    id: str
    name: str
    # Raw JSON string as the model produced it; parse with `json.loads` (may be invalid).
    arguments: str = "{}"


class Message(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: Content | None = None
    # Assistant turns that called tools, and the tool results that answer them.
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None

    def to_openai(self) -> dict[str, Any]:
        out: dict[str, Any] = {"role": self.role, "content": self.content}
        if self.tool_calls:
            out["tool_calls"] = [
                {
                    "id": call.id,
                    "type": "function",
                    "function": {"name": call.name, "arguments": call.arguments},
                }
                for call in self.tool_calls
            ]
        if self.tool_call_id:
            out["tool_call_id"] = self.tool_call_id
        return out


class LLMResponse(BaseModel):
    text: str
    # Nemotron returns its chain of thought separately. Log/debug only; never show it to users.
    reasoning: str | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)
    model: str
    provider: str = ""
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    latency_ms: int


class LLMError(RuntimeError):
    """Provider unreachable, timed out or returned an error. Callers should degrade gracefully.

    `retryable` is True for timeouts, connection errors, 429 and 5xx; False for 4xx such as a
    bad key or a malformed request, where retrying cannot help.
    """

    def __init__(self, message: str, *, retryable: bool = True, status: int | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status = status


class LLMClient(Protocol):
    name: str

    async def chat(
        self,
        messages: list[Message],
        *,
        max_tokens: int = 1024,
        temperature: float = 0.2,
        reasoning: bool = True,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | None = None,
        response_format: dict[str, Any] | None = None,
        timeout_s: float | None = None,
    ) -> LLMResponse: ...


def text_part(text: str) -> dict[str, Any]:
    return {"type": "text", "text": text}


def image_part(image: bytes, mime: str = "image/jpeg") -> dict[str, Any]:
    """Inline image for VL models. The image is sent to the provider, never stored."""
    data = base64.b64encode(image).decode()
    return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data}"}}


class _LimitedClient:
    """Caps in-flight calls and, optionally, calls per rolling minute."""

    def __init__(self, inner: LLMClient, *, max_concurrency: int, rpm: int | None = None):
        self._inner = inner
        self.name = inner.name
        self._sem = asyncio.Semaphore(max_concurrency)
        self._rpm = rpm
        self._sent: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def _wait_for_slot(self) -> None:
        if not self._rpm:
            return
        async with self._lock:
            while True:
                now = time.monotonic()
                while self._sent and now - self._sent[0] >= 60:
                    self._sent.popleft()
                if len(self._sent) < self._rpm:
                    self._sent.append(now)
                    return
                await asyncio.sleep(60 - (now - self._sent[0]))

    async def chat(self, messages: list[Message], **kwargs: Any) -> LLMResponse:
        await self._wait_for_slot()
        async with self._sem:
            return await self._inner.chat(messages, **kwargs)


class _FallbackClient:
    """Tries the primary provider; on failure tries the fallback once."""

    def __init__(self, primary: LLMClient, fallback: LLMClient):
        self._primary = primary
        self._fallback = fallback
        self.name = f"{primary.name}+{fallback.name}"

    async def chat(self, messages: list[Message], **kwargs: Any) -> LLMResponse:
        try:
            return await self._primary.chat(messages, **kwargs)
        except LLMError as exc:
            logger.warning(
                "Primary %s failed (%s); trying %s", self._primary.name, exc, self._fallback.name
            )
            return await self._fallback.chat(messages, **kwargs)


class _RetryingClient:
    def __init__(self, inner: LLMClient, *, attempts: int, backoff_s: float):
        self._inner = inner
        self.name = inner.name
        self._attempts = max(1, attempts)
        self._backoff_s = backoff_s

    async def chat(self, messages: list[Message], **kwargs: Any) -> LLMResponse:
        for attempt in range(1, self._attempts + 1):
            try:
                return await self._inner.chat(messages, **kwargs)
            except LLMError as exc:
                if not exc.retryable or attempt == self._attempts:
                    raise
                delay = self._backoff_s * 2 ** (attempt - 1)
                logger.info("LLM attempt %d failed (%s); retrying in %.1fs", attempt, exc, delay)
                await asyncio.sleep(delay)
        raise AssertionError("unreachable")


class _LoggedClient:
    """Wraps a provider so every call is timed and logged in one place.

    Logs metadata only (provider, model, latency, token counts). Never log message content:
    Everyday-mode documents must not reach logs (SOP section 10).
    """

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
            "LLM call provider=%s model=%s latency_ms=%d tokens_in=%s tokens_out=%s tools=%d",
            reply.provider or self.name,
            reply.model,
            reply.latency_ms,
            reply.prompt_tokens,
            reply.completion_tokens,
            len(reply.tool_calls),
        )
        return reply


def _nvidia_build_client() -> LLMClient:
    from app.brain.nemotron import NemotronClient

    settings, brain = get_settings(), get_brain_settings()
    client = NemotronClient(
        base_url=brain.nvidia_build_base_url,
        api_key=settings.nvidia_build_api_key,
        model=brain.nvidia_build_model,
        name="nvidia_build",
    )
    return _LimitedClient(client, max_concurrency=brain.max_concurrency, rpm=brain.nvidia_build_rpm)


@lru_cache
def get_llm() -> LLMClient:
    settings, brain = get_settings(), get_brain_settings()
    provider = settings.llm_provider
    if provider == "nemotron":
        from app.brain.nemotron import NemotronClient

        client: LLMClient = _LimitedClient(NemotronClient(), max_concurrency=brain.max_concurrency)
        if settings.nvidia_build_api_key:
            client = _FallbackClient(client, _nvidia_build_client())
    elif provider == "nvidia_build":
        client = _nvidia_build_client()
    else:
        raise ValueError(f"Unsupported LLM_PROVIDER={provider!r} (use nemotron or nvidia_build)")
    return _LoggedClient(
        _RetryingClient(client, attempts=brain.max_attempts, backoff_s=brain.backoff_base_s)
    )
