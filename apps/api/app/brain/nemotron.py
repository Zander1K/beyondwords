"""Nemotron client for any OpenAI-compatible endpoint.

Used for Verda/vLLM (primary, the Junction-hosted endpoint) and NVIDIA Build (fallback,
~40 req/min/key). Both speak `POST {base_url}/chat/completions`. Use it through
`app.brain.llm.get_llm()`, which adds retries, rate limiting, fallback and logging.
"""

import time
from typing import Any

import httpx

from app.brain.llm import LLMError, LLMResponse, Message, ToolCall
from app.config import get_settings


class NemotronClient:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        name: str = "nemotron",
    ) -> None:
        settings = get_settings()
        base_url = base_url or settings.nemotron_base_url
        if not base_url:
            raise LLMError("NEMOTRON_BASE_URL is not set (see .env.example)", retryable=False)
        self.name = name
        self._model = model or settings.nemotron_model
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key or settings.nemotron_api_key}"},
            timeout=settings.nemotron_timeout_s,
        )

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
    ) -> LLMResponse:
        body: dict[str, Any] = {
            "model": self._model,
            "messages": [m.to_openai() for m in messages],
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if not reasoning:
            # Skips the thinking pass: much faster, use for simple, latency-sensitive calls.
            body["chat_template_kwargs"] = {"enable_thinking": False}
        if tools:
            body["tools"] = tools
            if tool_choice:
                body["tool_choice"] = tool_choice
        if response_format:
            body["response_format"] = response_format

        start = time.perf_counter()
        try:
            response = await self._client.post(
                "/chat/completions",
                json=body,
                timeout=timeout_s if timeout_s is not None else httpx.USE_CLIENT_DEFAULT,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            raise LLMError(
                f"{self.name} returned {status}: {exc.response.text[:300]}",
                retryable=status == 429 or status >= 500,
                status=status,
            ) from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"{self.name} request failed: {exc!r}") from exc
        latency_ms = int((time.perf_counter() - start) * 1000)

        try:
            data = response.json()
            message = data["choices"][0]["message"]
        except (ValueError, KeyError, IndexError) as exc:
            raise LLMError(f"{self.name} sent an unexpected response: {exc!r}") from exc
        usage = data.get("usage") or {}
        return LLMResponse(
            text=message.get("content") or "",
            # vLLM versions differ on the field name.
            reasoning=message.get("reasoning") or message.get("reasoning_content"),
            tool_calls=[
                ToolCall(
                    id=call.get("id") or f"call_{i}",
                    name=call["function"]["name"],
                    arguments=call["function"].get("arguments") or "{}",
                )
                for i, call in enumerate(message.get("tool_calls") or [])
            ],
            model=data.get("model", self._model),
            provider=self.name,
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            latency_ms=latency_ms,
        )
