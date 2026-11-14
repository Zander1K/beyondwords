"""POST /users/login: creates a reader the first time a username is used, then finds them."""

from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import OperationalError

from app.main import app
from app.routers import users


@pytest.fixture(autouse=True)
def _session() -> Iterator[None]:
    from app.db.session import get_session

    async def fake() -> object:
        yield object()

    app.dependency_overrides[get_session] = fake
    yield
    app.dependency_overrides.clear()


def _user(**over: object) -> SimpleNamespace:
    fields: dict[str, object] = {
        "id": 7,
        "username": "ada_l",
        "display_name": None,
        "support_level": "read_along",
        "glasses_type": None,
        "voice": None,
        "settings": None,
    }
    return SimpleNamespace(**{**fields, **over})


async def _login(username: str) -> tuple[int, dict[str, object]]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/users/login", json={"username": username})
    return response.status_code, response.json()


async def test_new_username_creates_a_reader(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake(session: object, username: str) -> tuple[object, bool]:
        assert username == "  Ada_L "  # normalising is the repository's job
        return _user(), True

    monkeypatch.setattr(users, "get_or_create_user", fake)
    status, data = await _login("  Ada_L ")
    assert status == 200
    assert data["id"] == 7 and data["created"] is True
    assert data["onboarded"] is False  # a brand-new reader still has setup to do


async def test_known_username_is_found_not_created(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake(session: object, username: str) -> tuple[object, bool]:
        return _user(), False

    monkeypatch.setattr(users, "get_or_create_user", fake)
    _, data = await _login("ada_l")
    assert data["created"] is False


async def test_bad_username_is_a_422() -> None:
    status, data = await _login("no spaces!")
    assert status == 422
    assert "Username" in str(data["detail"])


async def test_database_down_is_a_503(monkeypatch: pytest.MonkeyPatch) -> None:
    async def down(session: object, username: str) -> tuple[object, bool]:
        raise OperationalError("select", {}, Exception("down"))

    monkeypatch.setattr(users, "get_or_create_user", down)
    status, _ = await _login("ada_l")
    assert status == 503


# --- onboarding ------------------------------------------------------------------------------

ANSWERS = {
    "support_level": "solo",
    "glasses_type": "gen2",
    "display_name": "  Ada  ",
    "spacing": {"letter_spacing": 0.1, "word_spacing": 0.3, "line_height": 1.9, "font_size": 1.25},
}


class FakeSession:
    """Just enough of AsyncSession for complete_onboarding."""

    def __init__(self, user: object | None) -> None:
        self.user = user
        self.added: list[object] = []
        self.commits = 0

    async def get(self, model: object, key: int) -> object | None:
        return self.user

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, obj: object) -> None:
        return None


async def test_onboarding_saves_answers_marks_onboarded_and_logs_the_start() -> None:
    from app.db.repositories.users import complete_onboarding, to_profile
    from app.schemas.users import OnboardingRequest

    user = _user()
    session = FakeSession(user)
    saved = await complete_onboarding(session, 7, OnboardingRequest(**ANSWERS))  # type: ignore[arg-type]
    assert saved is user
    assert (user.support_level, user.glasses_type, user.display_name) == ("solo", "gen2", "Ada")
    assert user.settings["spacing"]["lineHeight"] == 1.9  # saved like the other readers
    assert user.settings["onboarding"]["completed_at"]
    profile = to_profile(user)  # type: ignore[arg-type]
    assert profile.onboarded is True and profile.spacing is not None
    (event,) = session.added
    assert event.event_type == "mode_changed" and event.mode == "solo"  # type: ignore[attr-defined]
    assert event.payload == {"from": "read_along", "to": "solo", "source": "onboarding"}  # type: ignore[attr-defined]
    assert session.commits == 1


async def test_onboarding_for_an_unknown_reader_is_none() -> None:
    from app.db.repositories.users import complete_onboarding
    from app.schemas.users import OnboardingRequest

    assert await complete_onboarding(FakeSession(None), 1, OnboardingRequest(**ANSWERS)) is None  # type: ignore[arg-type]


async def _put(user_id: int, body: dict[str, object]) -> tuple[int, dict[str, object]]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.put(f"/users/{user_id}/onboarding", json=body)
    return response.status_code, response.json()


async def test_onboarding_route_returns_the_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake(session: object, user_id: int, answers: object) -> object:
        return _user(
            support_level="solo",
            settings={"onboarding": {"completed_at": "2026-11-14T00:00:00+00:00"}},
        )

    monkeypatch.setattr(users, "complete_onboarding", fake)
    status, data = await _put(7, ANSWERS)
    assert status == 200
    assert data["support_level"] == "solo" and data["onboarded"] is True


async def test_onboarding_route_404_for_unknown_reader(monkeypatch: pytest.MonkeyPatch) -> None:
    async def none(session: object, user_id: int, answers: object) -> None:
        return None

    monkeypatch.setattr(users, "complete_onboarding", none)
    assert (await _put(99, ANSWERS))[0] == 404


@pytest.mark.parametrize(
    "bad",
    [
        {**ANSWERS, "support_level": "expert"},
        {**ANSWERS, "glasses_type": "ray-ban-classic"},
        {**ANSWERS, "spacing": {**ANSWERS["spacing"], "font_size": 9}},  # type: ignore[dict-item]
    ],
)
async def test_onboarding_rejects_values_outside_the_allowed_sets(bad: dict[str, object]) -> None:
    assert (await _put(7, bad))[0] == 422
