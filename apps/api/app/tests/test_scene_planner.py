"""Scene planning before illustrations: whether to draw, what to draw, and safe fallbacks.

Gemini is faked; no network or key. Cases come from the real-book test run (metaphors drawn
literally, wrong period details, sensitive scenes).
"""

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import pytest
from google.genai import errors as genai_errors
from httpx import ASGITransport, AsyncClient

from app.books.library import Library
from app.db.models import Book
from app.gemini.context import BookContext, ReadingContext
from app.gemini.images import (
    IllustrationError,
    IllustrationErrorReason,
    IllustrationService,
    get_illustration_service,
)
from app.gemini.scene_planner import GeminiScenePlanner, ScenePlan
from app.gemini.tools import ToolRunner, UnavailableBrain
from app.main import app
from app.routers.books import get_library

TWO_CITIES = BookContext(
    title="A Tale of Two Cities", author="Charles Dickens", publication_year=1859,
    setting_era="revolutionary Paris in the 1790s",
)  # fmt: skip
HOLMES = BookContext(title="The Adventures of Sherlock Holmes", author="Arthur Conan Doyle",
                     setting_era="Victorian London in the 1890s")  # fmt: skip


# --- the Gemini planner ----------------------------------------------------------------------


class JsonModels:
    def __init__(self, result: Any, delay: float = 0) -> None:
        self.result, self.delay = result, delay
        self.requests: list[dict[str, Any]] = []

    async def generate_content(self, **kwargs: Any) -> Any:
        self.requests.append(kwargs)
        await asyncio.sleep(self.delay)
        if isinstance(self.result, Exception):
            raise self.result
        text = self.result if isinstance(self.result, str) else json.dumps(self.result)
        return SimpleNamespace(text=text)


def _planner(result: Any, delay: float = 0) -> tuple[GeminiScenePlanner, JsonModels]:
    models = JsonModels(result, delay)
    client = SimpleNamespace(aio=SimpleNamespace(models=models))
    return GeminiScenePlanner(client, "plan-model", timeout_seconds=0.2), models


async def test_planner_resolves_a_metaphor_into_a_literal_scene() -> None:
    planner, models = _planner(
        {
            "illustratable": True,
            "scene": "Six wooden carts rolling through a crowded Paris "
            "street towards a tall scaffold.",
            "reason": "",
        }  # fmt: skip
    )
    plan = await planner.plan("Six tumbrils carry the day's wine to La Guillotine.", "sentence",
                              TWO_CITIES)  # fmt: skip
    assert plan == ScenePlan(
        illustratable=True,
        scene="Six wooden carts rolling through a crowded Paris street towards a tall scaffold.",
        reason="",
    )
    request = models.requests[0]
    assert "A Tale of Two Cities" in request["contents"] and "1790s" in request["contents"]
    assert request["config"].response_mime_type == "application/json"
    assert request["config"].response_json_schema["required"] == [
        "illustratable",
        "scene",
        "reason",
    ]


async def test_planner_can_refuse_with_a_spoken_reason() -> None:
    planner, _ = _planner(
        {
            "illustratable": False,
            "scene": "",
            "reason": "This part is better explained than pictured.",
        }
    )
    plan = await planner.plan("And on the ground beside her was a leg-iron.", "sentence", None)
    assert not plan.illustratable and plan.reason == "This part is better explained than pictured."


@pytest.mark.parametrize(
    "result",
    [
        "not json at all",
        {"scene": "missing the decision"},
        genai_errors.ServerError(503, {"error": {"code": 503, "status": "UNAVAILABLE"}}),
    ],
)
async def test_planner_failure_falls_back_to_the_raw_text(result: Any) -> None:
    planner, _ = _planner(result)
    plan = await planner.plan("hansom cab", "phrase", HOLMES)
    assert plan == ScenePlan(illustratable=True, scene="hansom cab", planned=False)


async def test_slow_planner_falls_back() -> None:
    planner, _ = _planner({"illustratable": True, "scene": "x", "reason": ""}, delay=1)
    plan = await planner.plan("hansom cab", "phrase", HOLMES)
    assert plan.planned is False and plan.scene == "hansom cab"


# --- the illustration service with a planner -------------------------------------------------


class FakePlanner:
    version = "fake_plan_v1"

    def __init__(self, plan: ScenePlan) -> None:
        self.result = plan
        self.calls: list[tuple[str, str, BookContext | None]] = []

    async def plan(self, text: str, kind: str, book: BookContext | None) -> ScenePlan:
        self.calls.append((text, kind, book))
        return self.result


class ImageModels:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    async def generate_content(self, **kwargs: Any) -> Any:
        self.prompts.append(kwargs["contents"])
        part = SimpleNamespace(inline_data=SimpleNamespace(data=b"png", mime_type="image/png"))
        return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]))])


def _service(plan: ScenePlan) -> tuple[IllustrationService, FakePlanner, ImageModels]:
    planner, models = FakePlanner(plan), ImageModels()
    client = SimpleNamespace(aio=SimpleNamespace(models=models))
    service = IllustrationService(client, "image-model", 5, 8, planner=planner)
    return service, planner, models


HANSOM_SCENE = ScenePlan(
    illustratable=True,
    scene="A two-wheeled black hansom cab with the driver seated high up behind the passenger "
    "cabin, pulled by one horse on a cobbled London street",
)


async def test_planned_scene_is_what_gets_drawn() -> None:
    service, planner, models = _service(HANSOM_SCENE)
    result = await service.illustrate("hansom cab", book=HOLMES)

    assert planner.calls == [("hansom cab", "phrase", HOLMES)]
    assert "two-wheeled black hansom cab with the driver seated high up" in models.prompts[0]
    assert "Victorian London in the 1890s" in models.prompts[0]  # era taken from the book
    assert result.planned and result.scene == HANSOM_SCENE.scene


async def test_refusal_is_cached_and_nothing_is_drawn() -> None:
    no = ScenePlan(
        illustratable=False, scene="", reason="This part is better explained than pictured."
    )
    service, planner, models = _service(no)
    for _ in range(2):
        with pytest.raises(IllustrationError) as exc:
            await service.illustrate("And on the ground beside her was a leg-iron.")
        assert exc.value.reason is IllustrationErrorReason.NOT_SUITABLE
        assert exc.value.detail == "This part is better explained than pictured."
    assert len(planner.calls) == 1  # second refusal from cache
    assert models.prompts == []


async def test_same_word_in_different_books_is_planned_separately() -> None:
    service, planner, _ = _service(HANSOM_SCENE)
    a = await service.illustrate("cab", book=HOLMES)
    b = await service.illustrate("cab", book=TWO_CITIES)
    again = await service.illustrate("cab", book=HOLMES)
    assert a.id != b.id and again.id == a.id
    assert len(planner.calls) == 2


# --- endpoint and conversation tool ----------------------------------------------------------


class OneBookStore:
    async def get(self, book_id: int) -> Book | None:
        if book_id != 3:
            return None
        return Book(
            id=3,
            title="The Adventures of Sherlock Holmes",
            author="Arthur Conan Doyle",
            setting_era="Victorian London in the 1890s",
        )

    async def get_by_isbn(self, isbn: str) -> Book | None:
        return None

    async def add(self, book: Book) -> Book:
        return book


@pytest.fixture
def install() -> Any:
    def _install(service: IllustrationService) -> None:
        app.dependency_overrides[get_illustration_service] = lambda: service
        app.dependency_overrides[get_library] = lambda: Library(OneBookStore(), None)  # type: ignore[arg-type]

    yield _install
    app.dependency_overrides.clear()


def _http() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_endpoint_uses_book_and_returns_the_scene(install: Any) -> None:
    service, planner, _ = _service(HANSOM_SCENE)
    install(service)
    async with _http() as client:
        response = await client.post("/illustrate", json={"text": "hansom cab", "book_id": 3})
    assert response.status_code == 200
    body = response.json()
    assert body["planned"] is True and body["scene"] == HANSOM_SCENE.scene
    assert planner.calls[0][2] is not None
    assert planner.calls[0][2].title == "The Adventures of Sherlock Holmes"


async def test_endpoint_refusal_is_422_with_the_reason(install: Any) -> None:
    service, _, _ = _service(ScenePlan(False, "", "This part is better explained than pictured."))
    install(service)
    async with _http() as client:
        response = await client.post("/illustrate", json={"text": "The man was hanged at dawn."})
    assert response.status_code == 422
    assert response.json()["detail"] == "This part is better explained than pictured."


async def test_conversation_tool_explains_in_words_when_refused() -> None:
    service, _, _ = _service(ScenePlan(False, "", "Better explained."))
    runner = ToolRunner(UnavailableBrain(), service, ReadingContext(book=TWO_CITIES), 1)
    result = await runner.run("illustrate", {"text": "Six tumbrils carry the day's wine."})
    assert "explain it in words" in result["error"]
    assert runner.outcome.image_url is None
