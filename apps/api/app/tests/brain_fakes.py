"""Scripted stand-in for the LLM, for brain tests (no network)."""

import json
from typing import Any

from app.brain.llm import LLMError, LLMResponse, Message, ToolCall


class FakeLLM:
    """Returns queued replies in order. Each item is a str (text), a dict (JSON text),
    a list[ToolCall], or an LLMError to raise. Records every call in `.calls`."""

    name = "fake"

    def __init__(self, *replies: Any):
        self.replies = list(replies)
        self.calls: list[dict[str, Any]] = []

    async def chat(self, messages: list[Message], **kwargs: Any) -> LLMResponse:
        self.calls.append({"messages": messages, **kwargs})
        if not self.replies:
            raise AssertionError("FakeLLM ran out of replies")
        item = self.replies.pop(0)
        if isinstance(item, LLMError):
            raise item
        tool_calls: list[ToolCall] = []
        text = ""
        if isinstance(item, list):
            tool_calls = item
        elif isinstance(item, dict):
            text = json.dumps(item)
        else:
            text = item
        return LLMResponse(text=text, tool_calls=tool_calls, model="fake", latency_ms=1)
