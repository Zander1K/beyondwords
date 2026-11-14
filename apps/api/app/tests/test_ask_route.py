"""POST /ask: Nemotron answers through app.brain.qa. No network: FakeLLM plays Nemotron."""

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.books.library import Library
from app.brain.llm import LLMError, ToolCall
from app.brain.qa import QuestionService, QuestionUnavailableError, get_question_service
from app.db.models import Book
from app.gemini.illustrator import GeminiIllustrator
from app.gemini.images import IllustrationError, IllustrationErrorReason, get_illustration_service
from app.main import app
from app.routers.books import get_library
from app.tests.brain_fakes import FakeLLM

LINES = [("L1", "The knight was tired."), ("L2", "The portcullis rose.")]


def _service(llm: Any, timeout: float = 5.0) -> QuestionService:
    return QuestionService(timeout_seconds=timeout, session_ttl_seconds=60, llm=llm)


class Pictures:
    async def illustrate(self, text: str, setting_era: Any = None, book: Any = None) -> Any:
        return SimpleNamespace(id="abc123")


class NoPictures:
    async def illustrate(self, text: str, setting_era: Any = None, book: Any = None) -> Any:
        raise IllustrationError(IllustrationErrorReason.NOT_SUITABLE, "better explained")


# --- QuestionService -------------------------------------------------------------------------


async def test_answer_is_grounded_and_cites_page_lines() -> None:
    service = _service(FakeLLM("A portcullis is a heavy castle gate [page:L2]."))
    reply = await service.ask("what is a portcullis", page_lines=LINES)
    assert reply.answer == "A portcullis is a heavy castle gate."
    assert reply.cited_lines == ["L2"] and reply.grounded


async def test_follow_up_sends_earlier_turns_in_same_session() -> None:
    llm = FakeLLM("He was tired from riding [page:L1].", "Yes, very tired [page:L1].")
    service = _service(llm)
    first = await service.ask("how did he feel", page_lines=LINES)
    await service.ask("really?", page_lines=LINES, session_id=first.session_id)
    turns = [m.content for m in llm.calls[1]["messages"] if m.role in ("user", "assistant")]
    assert turns == ["how did he feel", "He was tired from riding.", "really?"]


async def test_new_or_ended_session_starts_without_history() -> None:
    llm = FakeLLM("Tired [page:L1].", "A gate [page:L2].")
    service = _service(llm)
    first = await service.ask("how did he feel", page_lines=LINES)
    service.end_session(first.session_id)
    await service.ask("what rose?", page_lines=LINES, session_id=first.session_id)
    assert [m.role for m in llm.calls[1]["messages"]] == ["system", "system", "user"]


async def test_misheard_word_and_pointed_word_reach_the_agent() -> None:
    llm = FakeLLM("It is a heavy castle gate [page:L2].")
    await _service(llm).ask(
        "what does port cullis mean",
        page_lines=LINES,
        current_line_id="L2",
        pointed_word="portcullis",
    )
    messages = llm.calls[0]["messages"]
    assert messages[-1].content == "what does portcullis mean"
    assert '"word": "portcullis"' in messages[1].content and '"page:L2"' in messages[1].content


async def test_model_down_is_unavailable() -> None:
    with pytest.raises(QuestionUnavailableError):
        await _service(FakeLLM(LLMError("down"))).ask("?", page_lines=LINES)


async def test_slow_model_is_unavailable() -> None:
    class Slow:
        name = "slow"

        async def chat(self, messages: Any, **kwargs: Any) -> Any:
            await asyncio.sleep(1)

    with pytest.raises(QuestionUnavailableError):
        await _service(Slow(), timeout=0.05).ask("?", page_lines=LINES)


async def test_nemotron_illustrates_through_gemini() -> None:
    llm = FakeLLM(
        [ToolCall(id="c1", name="illustrate", arguments='{"concept": "portcullis"}')],
        "Here is a portcullis, a heavy castle gate [page:L2].",
    )
    reply = await _service(llm).ask(
        "show me a portcullis", page_lines=LINES, illustrator=GeminiIllustrator(Pictures())
    )
    assert reply.image_url == "/illustrations/abc123" and reply.tool_steps == ["illustrate"]


async def test_illustrator_returns_none_when_not_drawable() -> None:
    assert await GeminiIllustrator(NoPictures()).illustrate("justice") is None  # type: ignore[arg-type]


# --- endpoint --------------------------------------------------------------------------------


class OneBookStore:
    async def get(self, book_id: int) -> Book | None:
        if book_id != 7:
            return None
        return Book(id=7, title="Pride and Prejudice", author="Jane Austen", setting_era="Regency")

    async def get_by_isbn(self, isbn: str) -> Book | None:
        return None

    async def add(self, book: Book) -> Book:
        return book


@pytest.fixture
def overrides() -> Any:
    def install(llm: Any) -> None:
        app.dependency_overrides[get_question_service] = lambda: _service(llm)
        app.dependency_overrides[get_library] = lambda: Library(OneBookStore(), None)  # type: ignore[arg-type]
        app.dependency_overrides[get_illustration_service] = lambda: NoPictures()

    yield install
    app.dependency_overrides.clear()


def _http() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_post_ask_answers_from_the_book_and_page(overrides: Any) -> None:
    llm = FakeLLM("Aloof means cold and distant [page:L4].")
    overrides(llm)
    async with _http() as client:
        response = await client.post(
            "/ask",
            json={
                "question": "What does aloof mean?",
                "book_id": 7,
                "page_lines": [{"id": "L4", "text": "Mr. Darcy was aloof."}],
                "current_line_id": "L4",
                "pointed_word": "aloof",
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "Aloof means cold and distant."
    assert body["cited_lines"] == ["L4"] and body["used_brain"] and body["session_id"]
    context = llm.calls[0]["messages"][1].content
    assert "Pride and Prejudice" in context and "Mr. Darcy was aloof." in context


async def test_unknown_book_still_answers(overrides: Any) -> None:
    overrides(FakeLLM("The knight was tired [page:L1]."))
    async with _http() as client:
        response = await client.post(
            "/ask",
            json={
                "question": "How was he?",
                "book_id": 999,
                "page_lines": [{"id": "L1", "text": "The knight was tired."}],
            },
        )
    assert response.status_code == 200


async def test_nemotron_down_is_503_with_paused_message(overrides: Any) -> None:
    overrides(FakeLLM(LLMError("down")))
    async with _http() as client:
        response = await client.post("/ask", json={"question": "Hello?"})
    assert response.status_code == 503
    assert response.json()["detail"] == "Explanations are paused. Reading continues."


async def test_end_session_endpoint(overrides: Any) -> None:
    overrides(FakeLLM())
    async with _http() as client:
        response = await client.delete("/ask/sessions/abc123")
    assert response.status_code == 204
