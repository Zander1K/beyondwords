"""Nemotron client: Verda/vLLM (primary) and NVIDIA Build (fallback, ~40 req/min/key).

The Verda endpoint is an OpenAI-compatible vLLM server, so this is a plain
`POST {NEMOTRON_BASE_URL}/chat/completions`. Use it through `app.brain.llm.get_llm()`.

TODO(Matthew): NVIDIA Build fallback when Verda is down or slow.
"""

import time
from typing import Any

import httpx

from app.brain.llm import LLMError, LLMResponse, Message
from app.config import get_settings


class NemotronClient:
    name = "nemotron"

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.nemotron_base_url:
            raise LLMError("NEMOTRON_BASE_URL is not set (see .env.example)")
        self._model = settings.nemotron_model
        self._client = httpx.AsyncClient(
            base_url=settings.nemotron_base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {settings.nemotron_api_key}"},
            timeout=settings.nemotron_timeout_s,
        )

    async def chat(
        self,
        messages: list[Message],
        *,
        max_tokens: int = 1024,
        temperature: float = 0.2,
        reasoning: bool = True,
    ) -> LLMResponse:
        body: dict[str, Any] = {
            "model": self._model,
            "messages": [m.model_dump() for m in messages],
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if not reasoning:
            # Skips the thinking pass: much faster, use for simple, latency-sensitive calls.
            body["chat_template_kwargs"] = {"enable_thinking": False}

        start = time.perf_counter()
        try:
            response = await self._client.post("/chat/completions", json=body)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise LLMError(
                f"Nemotron returned {exc.response.status_code}: {exc.response.text[:300]}"
            ) from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"Nemotron request failed: {exc!r}") from exc
        latency_ms = int((time.perf_counter() - start) * 1000)

        data = response.json()
        message = data["choices"][0]["message"]
        usage = data.get("usage") or {}
        return LLMResponse(
            text=message.get("content") or "",
            # vLLM versions differ on the field name.
            reasoning=message.get("reasoning") or message.get("reasoning_content"),
            model=data.get("model", self._model),
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            latency_ms=latency_ms,
        )
