"""Word bank rules: rescues, solo reads, owned words, fading support (brain/word_bank.py)."""

from datetime import UTC, datetime, timedelta

import pytest

from app.brain.qa import QuestionService
from app.brain.word_bank import (
    LEARNING,
    OWNED,
    InMemoryWordBank,
    Rules,
    WordEntry,
    page_words,
    profile_for_page,
    read_page,
    reader_profile,
    record_page_read,
    record_rescue,
    rescue,
    summary,
    word_key,
)
from app.tests.brain_fakes import FakeLLM

DAY1 = datetime(2026, 11, 14, 10, 0, tzinfo=UTC)
PAGE = [("L1", "The portcullis groaned upward,"), ("L2", "and a sentry waved him through.")]
RULES = Rules(owned_after_solo_reads=3, one_solo_read_per_day=True)


def _day(n: int, hour: int = 10) -> datetime:
    return DAY1 + timedelta(days=n - 1, hours=hour - 10)


def test_word_key_ignores_case_and_punctuation_but_not_word_forms() -> None:
    assert word_key("Portcullis,") == word_key("portcullis") == "portcullis"
    assert word_key("Bors’s") == "bors's"
    assert word_key("groaned") != word_key("groan")
    assert page_words(["The portcullis groaned."]) == {"the", "portcullis", "groaned"}


def test_rescue_adds_a_word_then_bumps_it() -> None:
    first = rescue(None, "Portcullis", sentence="The portcullis groaned.", now=DAY1)
    assert (first.word, first.status, first.times_rescued, first.solo_reads) == (
        "portcullis",
        LEARNING,
        1,
        0,
    )
    again = rescue(first, "portcullis", now=_day(2))
    assert again.times_rescued == 2 and again.context_sentence == "The portcullis groaned."


def test_rescue_sends_an_owned_word_back_to_learning() -> None:
    owned = WordEntry(word="sentry", status=OWNED, times_rescued=1, solo_reads=3)
    back = rescue(owned, "sentry", now=DAY1)
    assert back.status == LEARNING and back.solo_reads == 0 and back.times_rescued == 2


def test_owned_after_three_solo_reads_on_different_days() -> None:
    entries = {"portcullis": rescue(None, "portcullis", now=DAY1)}
    owned_on = None
    for day in (2, 3, 4):
        result = read_page(entries, PAGE, mode="read_along", now=_day(day), rules=RULES)
        entries.update({e.word: e for e in result.updated})
        if result.newly_owned:
            owned_on = day
    assert owned_on == 4 and entries["portcullis"].status == OWNED


def test_no_solo_read_on_the_day_of_the_rescue_or_twice_a_day() -> None:
    entries = {"portcullis": rescue(None, "portcullis", now=DAY1)}
    assert read_page(entries, PAGE, mode="solo", now=_day(1, 18), rules=RULES).credited == []
    first = read_page(entries, PAGE, mode="solo", now=_day(2), rules=RULES)
    entries.update({e.word: e for e in first.updated})
    second = read_page(entries, PAGE, mode="solo", now=_day(2, 19), rules=RULES)
    assert first.credited == ["portcullis"] and second.credited == []


def test_no_solo_read_in_listen_mode() -> None:
    entries = {"portcullis": rescue(None, "portcullis", now=DAY1)}
    assert read_page(entries, PAGE, mode="listen", now=_day(2), rules=RULES).updated == []


def test_no_solo_read_when_helped_on_this_page() -> None:
    entries = {
        "portcullis": rescue(None, "portcullis", now=DAY1),
        "sentry": rescue(None, "sentry", now=DAY1),
    }
    asked = read_page(entries, PAGE, mode="solo", rescued=["Portcullis"], now=_day(2), rules=RULES)
    assert asked.credited == ["sentry"]
    heard = read_page(entries, PAGE, mode="solo", helped_lines=["L2"], now=_day(2), rules=RULES)
    assert heard.credited == ["portcullis"]


def test_words_not_on_the_page_and_unknown_words_are_untouched() -> None:
    entries = {"surcoat": rescue(None, "surcoat", now=DAY1)}
    result = read_page(entries, PAGE, mode="solo", now=_day(2), rules=RULES)
    assert result.updated == [] and result.credited == []


def test_profile_flags_learning_words_and_drops_owned_ones_on_this_page_only() -> None:
    entries = [
        WordEntry(word="portcullis", status=LEARNING),
        WordEntry(word="sentry", status=OWNED),
        WordEntry(word="surcoat", status=LEARNING),  # not on this page
    ]
    profile = profile_for_page(entries, [text for _, text in PAGE], "solo")
    assert profile.struggled_words == ["portcullis"] and profile.owned_words == ["sentry"]
    assert profile.support_level == "solo"


def test_summary_counts_without_listing_struggles() -> None:
    entries = [WordEntry(word="a1", status=LEARNING), WordEntry(word="b2", status=OWNED)]
    assert summary(entries).__dict__ == {"learning": 1, "owned": 1, "owned_words": ["b2"]}


async def test_store_flow_from_rescue_to_owned_and_profile() -> None:
    store = InMemoryWordBank()
    await record_rescue(store, 7, "Sentry", sentence="A sentry waved him through.", now=DAY1)
    results = [
        await record_page_read(store, 7, PAGE, mode="read_along", now=_day(d), rules=RULES)
        for d in (2, 3, 4)
    ]
    assert [r.newly_owned for r in results] == [[], [], ["sentry"]]
    profile = await reader_profile(store, 7, [text for _, text in PAGE])
    assert profile.owned_words == ["sentry"] and profile.struggled_words == []
    assert await store.get_words(8) == []  # other readers are separate


@pytest.mark.parametrize("user_id", [5, None])
async def test_asking_what_a_word_means_is_a_rescue(user_id: int | None) -> None:
    words = InMemoryWordBank()
    llm = FakeLLM({"word": "sentry", "say_as": "SEN-tree", "meaning": "A guard."})
    service = QuestionService(timeout_seconds=5, session_ttl_seconds=60, llm=llm)
    await service.ask("what does sentry mean", page_lines=PAGE, user_id=user_id, words=words)
    saved = await words.get_words(5)
    if user_id is None:  # no reader known: nothing recorded
        assert saved == []
    else:
        assert [(e.word, e.times_rescued, e.context_sentence) for e in saved] == [
            ("sentry", 1, "and a sentry waved him through.")
        ]


async def test_a_broken_word_bank_never_costs_the_answer() -> None:
    class Broken(InMemoryWordBank):
        async def save_words(self, user_id: int, entries: list[WordEntry]) -> None:
            raise RuntimeError("database down")

    llm = FakeLLM({"word": "sentry", "say_as": "SEN-tree", "meaning": "A guard."})
    service = QuestionService(timeout_seconds=5, session_ttl_seconds=60, llm=llm)
    reply = await service.ask("what does sentry mean", page_lines=PAGE, user_id=5, words=Broken())
    assert reply.answer == "Sentry means a guard."
