"""POST /words/define: the brain's meaning, or just the syllables when the brain is down."""

from collections.abc import Iterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.brain.llm import LLMError
from app.brain.tools.define import WordBreakdown
from app.main import app
from app.routers import words


@pytest.fixture(autouse=True)
def _no_book() -> Iterator[None]:
    from app.routers.books import get_library

    class NoLibrary:
        async def get(self, book_id: int) -> None:
            return None

    app.dependency_overrides[get_library] = lambda: NoLibrary()
    yield
    app.dependency_overrides.clear()


async def _post(body: dict[str, object]) -> tuple[int, dict[str, object]]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/words/define", json=body)
    return response.status_code, response.json()


async def test_define_returns_the_brains_meaning(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake(word: str, sentence: str, book: object = None) -> WordBreakdown:
        assert (word, sentence) == ("portcullis", "The portcullis rose.")
        return WordBreakdown(
            word=word,
            say_as="port-KULL-iss",
            meaning="A heavy gate that slides up and down.",
            syllables=["port", "cul", "lis"],
        )

    monkeypatch.setattr(words, "define_word", fake)
    status, data = await _post({"word": "portcullis", "sentence": "The portcullis rose."})
    assert status == 200
    assert data["meaning"] == "A heavy gate that slides up and down."
    assert data["syllables"] == ["port", "cul", "lis"]
    assert data["degraded"] is False


async def test_define_degrades_to_syllables_when_the_brain_is_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def down(word: str, sentence: str, book: object = None) -> WordBreakdown:
        raise LLMError("down")

    monkeypatch.setattr(words, "define_word", down)
    status, data = await _post({"word": "aloof"})
    assert status == 200
    assert data["degraded"] is True
    assert data["meaning"] == ""
    assert data["syllables"]


async def test_define_rejects_an_empty_word() -> None:
    status, _ = await _post({"word": ""})
    assert status == 422
