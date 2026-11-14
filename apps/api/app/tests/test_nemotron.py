import json

import httpx
import pytest

from app.brain.llm import LLMError, Message
from app.brain.nemotron import NemotronClient


def _client(handler: httpx.MockTransport) -> NemotronClient:
    client = NemotronClient.__new__(NemotronClient)
    client.name = "nemotron"
    client._model = "nemotron-3.5-super-vl"
    client._client = httpx.AsyncClient(base_url="http://verda.test/v1", transport=handler)
    return client


async def test_chat_parses_content_reasoning_and_usage() -> None:
    sent: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "model": "nemotron-3.5-super-vl",
                "choices": [{"message": {"content": "ok", "reasoning": "thinking"}}],
                "usage": {"prompt_tokens": 21, "completion_tokens": 3},
            },
        )

    reply = await _client(httpx.MockTransport(handler)).chat(
        [Message(role="user", content="hi")], reasoning=False
    )

    assert reply.text == "ok"
    assert reply.reasoning == "thinking"
    assert reply.prompt_tokens == 21
    assert sent["chat_template_kwargs"] == {"enable_thinking": False}


async def test_http_error_becomes_llm_error() -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(401, text="bad key"))
    with pytest.raises(LLMError, match="401"):
        await _client(transport).chat([Message(role="user", content="hi")])
