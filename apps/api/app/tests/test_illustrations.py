"""Illustration service and endpoints, with a fake Gemini client (no network, no API key)."""

from types import SimpleNamespace
from typing import Any

import pytest
from google.genai import errors as genai_errors
from httpx import ASGITransport, AsyncClient

from app.gemini.images import (
    IllustrationError,
    IllustrationErrorReason,
    IllustrationService,
    TextKind,
    build_prompt,
    classify_text,
    get_illustration_service,
)
from app.main import app

PNG = b"\x89PNG\r\n\x1a\nfake-image-bytes"


def _image_response(data: bytes = PNG, mime: str = "image/png") -> Any:
    part = SimpleNamespace(inline_data=SimpleNamespace(data=data, mime_type=mime), text=None)
    return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]))])


class FakeModels:
    def __init__(self, result: Any) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    async def generate_content(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def _service(result: Any = None, *, configured: bool = True) -> tuple[IllustrationService, Any]:
    models = FakeModels(_image_response() if result is None else result)
    client = SimpleNamespace(aio=SimpleNamespace(models=models)) if configured else None
    service = IllustrationService(client, "test-image-model", timeout_seconds=5, cache_size=2)
    return service, models


# --- service -------------------------------------------------------------------------------


async def test_generates_and_caches_by_concept() -> None:
    service, models = _service()
    first = await service.illustrate("Portcullis", "medieval England")
    second = await service.illustrate("  portcullis! ", "medieval  England")
    assert first.data == PNG and first.mime_type == "image/png"
    assert second.id == first.id
    assert len(models.calls) == 1  # second request served from cache


async def test_request_uses_square_1k_image_output() -> None:
    service, models = _service()
    await service.illustrate("lantern")
    config = models.calls[0]["config"]
    assert config.response_modalities == ["IMAGE"]
    assert config.image_config.aspect_ratio == "1:1"
    assert config.image_config.image_size == "1K"
    assert models.calls[0]["model"] == "test-image-model"


async def test_cache_evicts_oldest() -> None:
    service, _ = _service()
    a = await service.illustrate("apple")
    await service.illustrate("boat")
    await service.illustrate("castle")  # cache_size=2
    assert service.get(a.id) is None


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("portcullis", ("portcullis", TextKind.WORD)),
        ("Portcullis!", ("Portcullis", TextKind.WORD)),
        (" horse-drawn   carriage ", ("horse-drawn carriage", TextKind.PHRASE)),
        ("will-o'-the-wisp", ("will-o'-the-wisp", TextKind.WORD)),
        ("The portcullis groaned upward.", ("The portcullis groaned upward.", TextKind.SENTENCE)),
        ("Mr. Darcy bowed to Elizabeth.", ("Mr. Darcy bowed to Elizabeth.", TextKind.SENTENCE)),
        (
            "\u201cLook!\u201d she cried, pointing at the dragon.",
            ("\u201cLook!\u201d she cried, pointing at the dragon.", TextKind.SENTENCE),
        ),
        ("three blind mice", ("three blind mice", TextKind.PHRASE)),
    ],
)
def test_classifies_words_phrases_and_sentences(text: str, expected: tuple[str, TextKind]) -> None:
    assert classify_text(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   ",
        "1984",
        "It rained. Then it stopped.",
        "He left. 3 days passed.",
        " ".join(["word"] * 31),
        "a" * 201,
        "<script>alert(1)</script>",
        "see https://example.com",
    ],
)
def test_rejects_paragraphs_and_junk(text: str) -> None:
    with pytest.raises(IllustrationError) as exc:
        classify_text(text)
    assert exc.value.reason is IllustrationErrorReason.NOT_ALLOWED


def test_word_prompt_includes_era_and_bans_text() -> None:
    prompt = build_prompt("carriage", TextKind.WORD, "19th-century England")
    assert "illustration of: carriage." in prompt and "19th-century England" in prompt
    assert "Do not write any text" in prompt
    assert "{" not in prompt  # every placeholder filled


def test_sentence_prompt_quotes_the_sentence_as_one_moment() -> None:
    prompt = build_prompt("The portcullis groaned upward.", TextKind.SENTENCE, None)
    assert '"The portcullis groaned upward."' in prompt
    assert "one picture" in prompt and "never a comic strip" in prompt


async def test_not_configured_without_key() -> None:
    service, _ = _service(configured=False)
    with pytest.raises(IllustrationError) as exc:
        await service.illustrate("lantern")
    assert exc.value.reason is IllustrationErrorReason.NOT_CONFIGURED


async def test_upstream_error_is_wrapped() -> None:
    error = genai_errors.ClientError(
        403, {"error": {"code": 403, "message": "denied", "status": "PERMISSION_DENIED"}}
    )
    service, _ = _service(error)
    with pytest.raises(IllustrationError) as exc:
        await service.illustrate("lantern")
    assert exc.value.reason is IllustrationErrorReason.UPSTREAM


async def test_response_without_image() -> None:
    no_image = SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[]))])
    service, _ = _service(no_image)
    with pytest.raises(IllustrationError) as exc:
        await service.illustrate("lantern")
    assert exc.value.reason is IllustrationErrorReason.NO_IMAGE


# --- endpoints -----------------------------------------------------------------------------


async def _client_with(service: IllustrationService) -> AsyncClient:
    app.dependency_overrides[get_illustration_service] = lambda: service
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture(autouse=True)
def _clear_overrides() -> Any:
    yield
    app.dependency_overrides.clear()


async def test_post_then_get_illustration() -> None:
    service, _ = _service()
    async with await _client_with(service) as client:
        created = await client.post("/illustrate", json={"text": "portcullis"})
        assert created.status_code == 200
        body = created.json()
        assert body["text"] == "portcullis" and body["kind"] == "word"
        assert body["mime_type"] == "image/png"
        image = await client.get(body["url"])
    assert image.status_code == 200
    assert image.content == PNG
    assert image.headers["content-type"] == "image/png"


async def test_sentence_request_is_illustrated() -> None:
    service, models = _service()
    sentence = "The tired knight rode slowly towards the castle gate."
    async with await _client_with(service) as client:
        response = await client.post("/illustrate", json={"text": sentence})
    assert response.status_code == 200
    assert response.json()["kind"] == "sentence"
    assert sentence in models.calls[0]["contents"]


async def test_paragraph_request_is_422() -> None:
    service, _ = _service()
    paragraph = "The knight rode to the castle. The gate was shut. He knocked twice."
    async with await _client_with(service) as client:
        response = await client.post("/illustrate", json={"text": paragraph})
    assert response.status_code == 422
    assert "one sentence" in response.json()["detail"]


async def test_gemini_failure_is_503_with_paused_message() -> None:
    service, _ = _service(configured=False)
    async with await _client_with(service) as client:
        response = await client.post("/illustrate", json={"text": "lantern"})
    assert response.status_code == 503
    assert response.json()["detail"] == "Illustrations are paused. Reading continues."


async def test_unknown_illustration_is_404() -> None:
    service, _ = _service()
    async with await _client_with(service) as client:
        response = await client.get("/illustrations/does-not-exist")
    assert response.status_code == 404
