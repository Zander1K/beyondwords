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


async def test_story_question_is_grounded_and_cites_page_lines() -> None:
    service = _service(FakeLLM("The portcullis rose as the knight arrived [page:L2]."))
    reply = await service.ask("what happened to the gate", page_lines=LINES)
    assert reply.answer == "The portcullis rose as the knight arrived."
    assert reply.cited_lines == ["L2"] and reply.grounded


DEFINITION = {"word": "portcullis", "say_as": "port-CULL-iss", "meaning": "A heavy castle gate."}


@pytest.mark.parametrize(
    ("question", "pointed"),
    [
        ("what does port cullis mean", None),  # misheard, fixed first
        ("Whats a portcullis?", None),
        ("what does this word mean", "portcullis"),
        ("I don't understand portcullis", None),
    ],
)
async def test_word_meaning_goes_to_define_word(question: str, pointed: str | None) -> None:
    llm = FakeLLM(DEFINITION)
    reply = await _service(llm).ask(
        question, page_lines=LINES, current_line_id="L2", pointed_word=pointed
    )
    assert reply.answer == "Portcullis means a heavy castle gate."
    assert reply.cited_lines == ["L2"] and reply.tool_steps == ["define"]
    assert '"sentence": "The portcullis rose."' in llm.calls[0]["messages"][1].content


def test_story_questions_and_names_are_not_word_questions() -> None:
    from app.brain.qa import meaning_target

    page = [("L1", "Mr. Darcy was aloof and proud.")]
    for question in ["why is Darcy aloof", "Darcy", "what is happening", "what does he mean"]:
        assert meaning_target(question, page) is None, question
    assert meaning_target("whats aloof mean", page) == ("aloof", "L1", page[0][1])


async def test_define_down_is_unavailable() -> None:
    with pytest.raises(QuestionUnavailableError):
        await _service(FakeLLM(LLMError("down"))).ask("what does portcullis mean", page_lines=LINES)


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
    llm = FakeLLM("It rose to let the knight in [page:L2].")
    await _service(llm).ask(
        "why did the port cullis rise",
        page_lines=LINES,
        current_line_id="L2",
        pointed_word="portcullis",
    )
    messages = llm.calls[0]["messages"]
    assert messages[-1].content == "why did the portcullis rise"
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
    llm = FakeLLM({"word": "aloof", "say_as": "uh-LOOF", "meaning": "Cold and distant."})
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
    sent = llm.calls[0]["messages"][1].content
    assert "Pride and Prejudice" in sent and "Mr. Darcy was aloof." in sent


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
