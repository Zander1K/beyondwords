"""POST /ask conversation: sessions, context, ask_brain / illustrate tools, failures.

Gemini is a scripted fake (no network, no key). Responses use the real google-genai types so the
tool-call parsing is exercised for real.
"""

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from google.genai import types
from httpx import ASGITransport, AsyncClient

from app.books.library import Library
from app.db.models import Book
from app.gemini.context import BookContext, PageLine, ReadingContext
from app.gemini.conversation import (
    ConversationError,
    ConversationErrorReason,
    ConversationService,
    get_conversation_service,
)
from app.gemini.images import IllustrationService
from app.gemini.tools import BrainAnswer, UnavailableBrain
from app.main import app
from app.routers.books import get_library

PAGE = ReadingContext(
    book=BookContext(title="The Castle", author="A. Writer", setting_era="medieval England"),
    page_lines=[PageLine("L1", "The knight was tired."), PageLine("L2", "The portcullis rose.")],
    current_line_id="L2",
)


def _text(text: str, *, thought: str | None = None) -> types.Content:
    parts = [types.Part(text=thought, thought=True)] if thought else []
    return types.Content(role="model", parts=[*parts, types.Part(text=text)])


def _call(name: str, **args: Any) -> types.Content:
    return types.Content(
        role="model", parts=[types.Part(function_call=types.FunctionCall(name=name, args=args))]
    )


class ScriptedModels:
    """Returns the scripted contents in order and records every request."""

    def __init__(self, *script: types.Content) -> None:
        self.script = list(script)
        self.requests: list[dict[str, Any]] = []

    async def generate_content(self, **kwargs: Any) -> Any:
        self.requests.append(kwargs)
        content = self.script.pop(0)
        return SimpleNamespace(candidates=[SimpleNamespace(content=content)])


class FakeBrain:
    def __init__(self, answer: BrainAnswer | None = None, delay: float = 0) -> None:
        self.answer = answer or BrainAnswer("He has ridden all day.", ["L1"])
        self.delay = delay
        self.questions: list[str] = []

    async def ask(self, question: str, context: ReadingContext) -> BrainAnswer:
        self.questions.append(question)
        await asyncio.sleep(self.delay)
        return self.answer


def _png_illustrations() -> IllustrationService:
    part = SimpleNamespace(inline_data=SimpleNamespace(data=b"png", mime_type="image/png"))
    response = SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]))])

    async def generate_content(**_: Any) -> Any:
        return response

    client = SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))
    )
    return IllustrationService(client, "image-model", timeout_seconds=5, cache_size=8)


def _service(
    *script: types.Content, brain: Any = None, configured: bool = True, brain_timeout: float = 1
) -> tuple[ConversationService, ScriptedModels]:
    models = ScriptedModels(*script)
    client = SimpleNamespace(aio=SimpleNamespace(models=models)) if configured else None
    service = ConversationService(
        client=client,
        model="chat-model",
        brain=brain or FakeBrain(),
        illustrations=_png_illustrations(),
        timeout_seconds=5,
        brain_timeout_seconds=brain_timeout,
        session_ttl_seconds=60,
    )
    return service, models


def _sent_texts(request: dict[str, Any]) -> list[str]:
    return [p.text for c in request["contents"] for p in c.parts or [] if p.text]


# --- service ---------------------------------------------------------------------------------


async def test_simple_answer_gets_page_and_book_context() -> None:
    service, models = _service(_text("A portcullis is a heavy castle gate.", thought="hmm"))
    reply = await service.ask("What is a portcullis?", PAGE)

    assert reply.answer == "A portcullis is a heavy castle gate."  # thought text left out
    assert reply.session_id and not reply.used_brain and reply.image_url is None
    config = models.requests[0]["config"]
    assert "[L2] The portcullis rose." in config.system_instruction
    assert "Title: The Castle" in config.system_instruction
    assert "finger is on line L2" in config.system_instruction
    assert config.thinking_config.thinking_level == types.ThinkingLevel.LOW
    assert models.requests[0]["model"] == "chat-model"


async def test_follow_up_sends_earlier_turns_in_same_session() -> None:
    service, models = _service(_text("A heavy gate."), _text("It keeps attackers out."))
    first = await service.ask("What is a portcullis?", PAGE)
    second = await service.ask("Why does a castle need one?", PAGE, first.session_id)

    assert second.session_id == first.session_id
    assert _sent_texts(models.requests[1]) == [
        "What is a portcullis?",
        "A heavy gate.",
        "Why does a castle need one?",
    ]


async def test_new_session_starts_without_history() -> None:
    service, models = _service(_text("One."), _text("Two."))
    await service.ask("First?", PAGE)
    await service.ask("Second?", PAGE)  # no session_id -> fresh conversation
    assert _sent_texts(models.requests[1]) == ["Second?"]


async def test_ask_brain_answer_is_used_and_cited() -> None:
    brain = FakeBrain()
    service, models = _service(
        _call("ask_brain", question="Why is the knight tired?"),
        _text("He has been riding all day."),
        brain=brain,
    )
    reply = await service.ask("Why is he tired?", PAGE)

    assert brain.questions == ["Why is the knight tired?"]
    assert reply.used_brain and reply.cited_lines == ["L1"]
    assert reply.tool_steps == ["ask_brain"]
    tool_result = models.requests[1]["contents"][-1].parts[0].function_response
    assert tool_result.name == "ask_brain"
    assert tool_result.response["answer"] == "He has ridden all day."


@pytest.mark.parametrize("brain", [UnavailableBrain(), FakeBrain(delay=0.5)])
async def test_brain_down_or_slow_lets_gemini_answer_from_the_page(brain: Any) -> None:
    service, models = _service(
        _call("ask_brain", question="Why?"),
        _text("The page says he is tired."),
        brain=brain,
        brain_timeout=0.05,
    )
    reply = await service.ask("Why is he tired?", PAGE)
    assert reply.answer == "The page says he is tired."
    assert not reply.used_brain
    assert "error" in models.requests[1]["contents"][-1].parts[0].function_response.response


async def test_illustrate_tool_returns_image_url() -> None:
    service, _ = _service(_call("illustrate", text="portcullis"), _text("Here is a portcullis."))
    reply = await service.ask("Show me a portcullis", PAGE)
    assert reply.image_url and reply.image_url.startswith("/illustrations/")
    assert reply.tool_steps == ["illustrate"]


async def test_endless_tool_calls_stop_after_the_loop_limit() -> None:
    service, models = _service(*[_call("ask_brain", question="?") for _ in range(5)])
    with pytest.raises(ConversationError) as exc:
        await service.ask("Loop?", PAGE)
    assert exc.value.reason is ConversationErrorReason.EMPTY
    assert len(models.requests) == 5  # 4 tool steps + 1 final try


async def test_not_configured_without_key() -> None:
    service, _ = _service(configured=False)
    with pytest.raises(ConversationError) as exc:
        await service.ask("Hello?", PAGE)
    assert exc.value.reason is ConversationErrorReason.NOT_CONFIGURED


async def test_ended_session_is_forgotten() -> None:
    service, models = _service(_text("One."), _text("Two."))
    first = await service.ask("First?", PAGE)
    service.end_session(first.session_id)
    await service.ask("Second?", PAGE, first.session_id)
    assert _sent_texts(models.requests[1]) == ["Second?"]


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
    def install(service: ConversationService) -> None:
        app.dependency_overrides[get_conversation_service] = lambda: service
        app.dependency_overrides[get_library] = lambda: Library(OneBookStore(), None)  # type: ignore[arg-type]

    yield install
    app.dependency_overrides.clear()


def _http() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_post_ask_uses_book_from_library(overrides: Any) -> None:
    service, models = _service(_text("It means proud and distant."))
    overrides(service)
    async with _http() as client:
        response = await client.post(
            "/ask",
            json={
                "question": "What does aloof mean?",
                "book_id": 7,
                "page_lines": [{"id": "L4", "text": "Mr. Darcy was aloof."}],
                "current_line_id": "L4",
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "It means proud and distant."
    assert body["session_id"] and body["cited_lines"] == [] and body["image_url"] is None
    system = models.requests[0]["config"].system_instruction
    assert "Title: Pride and Prejudice" in system and "[L4] Mr. Darcy was aloof." in system


async def test_unknown_book_still_answers(overrides: Any) -> None:
    service, models = _service(_text("Sure."))
    overrides(service)
    async with _http() as client:
        response = await client.post("/ask", json={"question": "Hi?", "book_id": 999})
    assert response.status_code == 200
    assert "Unknown (the reader has not scanned" in models.requests[0]["config"].system_instruction


async def test_gemini_failure_is_503_with_paused_message(overrides: Any) -> None:
    service, _ = _service(configured=False)
    overrides(service)
    async with _http() as client:
        response = await client.post("/ask", json={"question": "Hello?"})
    assert response.status_code == 503
    assert response.json()["detail"] == "Explanations are paused. Reading continues."


async def test_end_session_endpoint(overrides: Any) -> None:
    service, _ = _service()
    overrides(service)
    async with _http() as client:
        response = await client.delete("/ask/sessions/abc123")
    assert response.status_code == 204
