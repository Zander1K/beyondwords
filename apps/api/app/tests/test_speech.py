"""ElevenLabs speech: the client and /speech routes. A fake ElevenLabs (no network, no credits)."""

import json
from collections.abc import Callable, Iterator

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.elevenlabs.client import (
    BASE_URL,
    ElevenLabsClient,
    SpeechError,
    SpeechErrorReason,
    get_elevenlabs_client,
)
from app.main import app


def _client(
    handler: Callable[[httpx.Request], httpx.Response], key: str = "test-key"
) -> ElevenLabsClient:
    http = httpx.AsyncClient(base_url=BASE_URL, transport=httpx.MockTransport(handler))
    return ElevenLabsClient(
        api_key=key,
        voice_id="voice-default",
        tts_model="tts-model",
        stt_model="stt-model",
        http=http,
    )


# --- client ----------------------------------------------------------------------------------


async def test_tts_sends_the_key_text_voice_and_model_and_returns_the_audio() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["key"] = request.headers["xi-api-key"]
        seen["body"] = json.loads(request.read())
        return httpx.Response(200, content=b"MP3DATA")

    audio = await _client(handler).tts("Hello there", "voice-x")
    assert audio == b"MP3DATA"
    assert seen["path"] == "/v1/text-to-speech/voice-x"
    assert seen["key"] == "test-key"
    assert seen["body"] == {"text": "Hello there", "model_id": "tts-model"}


async def test_tts_uses_the_default_voice_and_remembers_repeated_phrases() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert request.url.path.endswith("/voice-default")
        return httpx.Response(200, content=b"A")

    client = _client(handler)
    assert await client.tts("same") == b"A"
    assert await client.tts("same") == b"A"
    assert calls == 1  # the second one came from memory (no second charge)
    await client.tts("different")
    assert calls == 2


async def test_stt_returns_the_text_and_says_when_nothing_was_heard() -> None:
    texts = iter(["  what does portcullis mean  ", "  "])

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/speech-to-text"
        return httpx.Response(200, json={"text": next(texts)})

    client = _client(handler)
    assert await client.stt(b"RIFF", "audio/wav") == "what does portcullis mean"
    with pytest.raises(SpeechError) as exc:
        await client.stt(b"RIFF", "audio/wav")
    assert exc.value.reason is SpeechErrorReason.NO_SPEECH


@pytest.mark.parametrize(
    ("status", "reason"),
    [
        (401, SpeechErrorReason.UNAUTHORIZED),
        (429, SpeechErrorReason.RATE_LIMITED),
        (500, SpeechErrorReason.FAILED),
    ],
)
async def test_errors_become_speech_errors(status: int, reason: SpeechErrorReason) -> None:
    client = _client(lambda r: httpx.Response(status, text="no"))
    with pytest.raises(SpeechError) as exc:
        await client.tts("x")
    assert exc.value.reason is reason


async def test_no_key_means_not_configured_without_calling_out() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("must not call ElevenLabs without a key")

    with pytest.raises(SpeechError) as exc:
        await _client(handler, key="").tts("x")
    assert exc.value.reason is SpeechErrorReason.NOT_CONFIGURED


async def test_a_timeout_is_a_speech_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    with pytest.raises(SpeechError) as exc:
        await _client(handler).tts("x")
    assert exc.value.reason is SpeechErrorReason.TIMEOUT


async def test_voices_are_mapped() -> None:
    body = {
        "voices": [
            {
                "voice_id": "v1",
                "name": "George",
                "category": "premade",
                "labels": {"descriptive": "warm"},
                "preview_url": "https://x/p.mp3",
            }
        ]
    }
    voices = await _client(lambda r: httpx.Response(200, json=body)).voices()
    assert [(v.id, v.name, v.description, v.category) for v in voices] == [
        ("v1", "George", "warm", "premade")
    ]


# --- routes ----------------------------------------------------------------------------------


@pytest.fixture
def use() -> Iterator[Callable[[ElevenLabsClient], None]]:
    def _use(client: ElevenLabsClient) -> None:
        app.dependency_overrides[get_elevenlabs_client] = lambda: client

    yield _use
    app.dependency_overrides.clear()


async def _call(method: str, path: str, **kwargs: object) -> httpx.Response:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.request(method, path, **kwargs)  # type: ignore[arg-type]


async def test_tts_route_returns_mp3(use: Callable[[ElevenLabsClient], None]) -> None:
    use(_client(lambda r: httpx.Response(200, content=b"MP3DATA")))
    r = await _call("POST", "/speech/tts", json={"text": "Hi"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.content == b"MP3DATA"


async def test_tts_route_is_a_503_when_speech_is_down_and_a_422_when_text_is_empty(
    use: Callable[[ElevenLabsClient], None],
) -> None:
    use(_client(lambda r: httpx.Response(500)))
    r = await _call("POST", "/speech/tts", json={"text": "Hi"})
    assert r.status_code == 503
    assert "paused" in r.json()["detail"].lower()
    assert (await _call("POST", "/speech/tts", json={"text": ""})).status_code == 422


async def test_stt_route_reads_raw_audio_and_returns_text(
    use: Callable[[ElevenLabsClient], None],
) -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body_has_audio"] = b"RIFFAUDIO" in request.read()
        return httpx.Response(200, json={"text": "why did he do that"})

    use(_client(handler))
    r = await _call(
        "POST", "/speech/stt", content=b"RIFFAUDIO", headers={"content-type": "audio/wav"}
    )
    assert r.status_code == 200 and r.json() == {"text": "why did he do that"}
    assert seen["body_has_audio"] is True


async def test_stt_route_edge_cases(use: Callable[[ElevenLabsClient], None]) -> None:
    use(_client(lambda r: httpx.Response(200, json={"text": ""})))
    assert (await _call("POST", "/speech/stt", content=b"")).status_code == 422  # no audio
    r = await _call("POST", "/speech/stt", content=b"RIFF", headers={"content-type": "audio/wav"})
    assert r.status_code == 422 and "catch" in r.json()["detail"]  # heard nothing


async def test_voices_route_lists_voices_and_the_default(
    use: Callable[[ElevenLabsClient], None],
) -> None:
    use(
        _client(
            lambda r: httpx.Response(200, json={"voices": [{"voice_id": "v1", "name": "George"}]})
        )
    )
    r = await _call("GET", "/speech/voices")
    assert r.status_code == 200
    assert r.json()["default_voice_id"] == "voice-default"
    assert r.json()["voices"][0]["name"] == "George"


def test_a_blank_voice_id_in_the_environment_means_the_default_voice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.config import get_settings
    from app.elevenlabs.client import DEFAULT_VOICE_ID

    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "")
    get_settings.cache_clear()
    get_elevenlabs_client.cache_clear()
    try:
        assert get_elevenlabs_client().voice_id == DEFAULT_VOICE_ID
    finally:
        get_settings.cache_clear()
        get_elevenlabs_client.cache_clear()
