"""Word bank and user_books repositories, on a real (in-memory) database."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Book, ReadingEvent, User
from app.db.repositories.user_books import link_book, list_user_books, touch_book
from app.db.repositories.word_bank import clean_word, list_words, record_word


async def _reader(db: AsyncSession, name: str = "ada") -> User:
    user = User(username=name)
    db.add(user)
    await db.commit()
    return user


async def _book(db: AsyncSession, title: str = "Lantern Days") -> Book:
    book = Book(title=title, isbn=None)
    db.add(book)
    await db.commit()
    return book


def test_clean_word_keeps_words_and_drops_junk() -> None:
    assert clean_word('  "Portcullis," ') == "portcullis"
    assert clean_word("don't") == "don't"
    for junk in ["", "—", "a", "qzx7", "x" * 80, "42"]:
        assert clean_word(junk) is None, junk


async def test_a_new_word_is_saved_with_where_it_was_met(db: AsyncSession) -> None:
    user, book = await _reader(db), await _book(db)
    entry = await record_word(
        db, user.id, "Portcullis,", sentence="The portcullis groaned upward.", book_id=book.id
    )
    assert entry is not None
    assert (entry.word, entry.times_rescued, entry.status) == ("portcullis", 1, "learning")
    assert entry.book_id == book.id
    assert entry.context_sentence == "The portcullis groaned upward."


async def test_looking_a_word_up_again_counts_it_and_keeps_the_latest_meeting(
    db: AsyncSession,
) -> None:
    user, book = await _reader(db), await _book(db)
    await record_word(db, user.id, "lantern", sentence="First sentence.", book_id=book.id)
    again = await record_word(db, user.id, "Lantern", sentence="Second sentence.")
    assert again is not None
    assert again.times_rescued == 2
    assert again.context_sentence == "Second sentence."
    assert again.book_id == book.id  # a lookup with no book keeps the book it had
    # No sentence this time: the earlier one is kept.
    kept = await record_word(db, user.id, "lantern")
    assert kept is not None and kept.context_sentence == "Second sentence."
    assert len(await list_words(db, user.id)) == 1


async def test_every_lookup_is_logged_as_a_progress_event_with_the_readers_level(
    db: AsyncSession,
) -> None:
    user = await _reader(db)
    await record_word(db, user.id, "harbour", source="ask")
    await record_word(db, user.id, "harbour")
    events = (await db.execute(select(ReadingEvent))).scalars().all()
    assert [e.event_type for e in events] == ["word_rescued", "word_rescued"]
    assert events[0].payload == {"word": "harbour", "source": "ask"}
    assert events[0].mode == "read_along"  # the reader's starting level


async def test_things_that_are_not_words_are_not_saved(db: AsyncSession) -> None:
    user = await _reader(db)
    assert await record_word(db, user.id, "qzx7") is None
    assert await list_words(db, user.id) == []
    assert (await db.execute(select(ReadingEvent))).scalars().all() == []


async def test_a_long_sentence_is_trimmed(db: AsyncSession) -> None:
    user = await _reader(db)
    entry = await record_word(db, user.id, "tide", sentence="word " * 200)
    assert entry is not None and len(entry.context_sentence or "") <= 300


async def test_words_belong_to_their_reader_and_come_newest_first(db: AsyncSession) -> None:
    ada, bo = await _reader(db, "ada"), await _reader(db, "bo")
    await record_word(db, ada.id, "older")
    await record_word(db, ada.id, "newer")
    await record_word(db, bo.id, "private")
    words = [e.word for e, _ in await list_words(db, ada.id)]
    assert words == ["newer", "older"]
    assert [e.word for e, _ in await list_words(db, bo.id)] == ["private"]


async def test_adding_a_book_links_it_once_and_reopening_does_not_duplicate(
    db: AsyncSession,
) -> None:
    user, book = await _reader(db), await _book(db)
    first = await link_book(db, user.id, book.id)
    second = await link_book(db, user.id, book.id)
    assert first.id == second.id
    assert len(await list_user_books(db, user.id)) == 1


async def test_the_book_opened_last_comes_first(db: AsyncSession) -> None:
    user = await _reader(db)
    a, b = await _book(db, "A"), await _book(db, "B")
    la = await link_book(db, user.id, a.id)
    await link_book(db, user.id, b.id)
    la.last_read_at = datetime.now(UTC) - timedelta(days=1)
    await db.commit()
    assert [book.title for _, book in await list_user_books(db, user.id)] == ["B", "A"]
    await touch_book(db, user.id, a.id)
    assert [book.title for _, book in await list_user_books(db, user.id)] == ["A", "B"]


async def test_opening_a_book_that_is_not_theirs_does_nothing(db: AsyncSession) -> None:
    user, book = await _reader(db), await _book(db)
    assert await touch_book(db, user.id, book.id) is None


# --- profiles must never fail on real stored settings ------------------------------------------


def _profile(settings: object) -> object:
    from app.db.repositories.users import to_profile

    return to_profile(User(id=1, username="x", support_level="read_along", settings=settings))  # type: ignore[arg-type]


def test_a_profile_reads_spacing_saved_with_the_web_apps_key_names() -> None:
    # Exactly the shape the existing readers' rows hold.
    saved = {
        "spacing": {"fontSize": 1.375, "lineHeight": 2.0, "wordSpacing": 0.3, "letterSpacing": 0.12}
    }
    profile = _profile(saved)
    assert profile.spacing is not None  # type: ignore[attr-defined]
    assert (profile.spacing.font_size, profile.spacing.line_height) == (1.375, 2.0)  # type: ignore[attr-defined]
    assert profile.onboarded is False  # type: ignore[attr-defined]  # spacing alone is not setup


def test_a_reader_who_is_already_set_up_is_not_sent_through_setup() -> None:
    from app.db.repositories.users import to_profile

    seeded = User(
        id=2, username="demo", support_level="listen", glasses_type="display", settings={}
    )
    assert to_profile(seeded).onboarded is True  # type: ignore[arg-type]
    fresh = User(id=3, username="new", support_level="read_along", settings=None)
    assert to_profile(fresh).onboarded is False  # type: ignore[arg-type]


def test_a_profile_also_reads_snake_case_spacing() -> None:
    saved = {
        "spacing": {
            "font_size": 1.2,
            "line_height": 1.8,
            "word_spacing": 0.2,
            "letter_spacing": 0.1,
        }
    }
    assert _profile(saved).spacing.font_size == 1.2  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    "settings",
    [
        None,
        {},
        [],
        "text",
        {"spacing": "wide"},
        {"spacing": {"fontSize": "big"}},
        {"spacing": {"fontSize": 99, "lineHeight": 2, "wordSpacing": 0.2, "letterSpacing": 0.1}},
        {"spacing": {"fontSize": 1.2}},
        {"onboarding": "done"},
        {"onboarding": None},
    ],
)
def test_odd_saved_settings_never_stop_a_profile_being_built(settings: object) -> None:
    profile = _profile(settings)
    assert profile.username == "x"  # type: ignore[attr-defined]
    assert profile.spacing is None  # type: ignore[attr-defined]
    assert profile.onboarded is False  # type: ignore[attr-defined]


async def test_setup_saves_spacing_in_the_same_style_as_the_other_readers(db: AsyncSession) -> None:
    from app.db.repositories.users import complete_onboarding, to_profile
    from app.schemas.users import OnboardingRequest, Spacing

    user = await _reader(db)
    spacing = Spacing(letter_spacing=0.1, word_spacing=0.3, line_height=1.9, font_size=1.25)
    saved = await complete_onboarding(
        db, user.id, OnboardingRequest(support_level="solo", spacing=spacing)
    )
    assert saved is not None
    assert saved.settings["spacing"] == {  # type: ignore[index]
        "letterSpacing": 0.1,
        "wordSpacing": 0.3,
        "lineHeight": 1.9,
        "fontSize": 1.25,
    }
    assert to_profile(saved).spacing == spacing and to_profile(saved).onboarded is True
