from app.brain.agent import NOT_IN_PAGES, UNAVAILABLE, ask
from app.brain.grounding import check_answer
from app.brain.llm import LLMError, ToolCall
from app.brain.tools.store import InMemoryStore
from app.schemas.brain import BookContext, CapturedPage, TraceEvent
from app.schemas.page import Line
from app.tests.brain_fakes import FakeLLM

BOX = [0.0, 0.0, 1.0, 0.05]
P11 = CapturedPage(
    page_id="p11",
    page_number=11,
    lines=[Line(id="L1", text="Sir Bors was exhausted after the long ride.", bbox=BOX)],
)
P12 = CapturedPage(
    page_id="p12",
    page_number=12,
    lines=[
        Line(id="L1", text="He reached the castle at dusk.", bbox=BOX),
        Line(id="L2", text="The portcullis groaned upward.", bbox=BOX),
    ],
)
P13 = CapturedPage(
    page_id="p13",
    page_number=13,
    lines=[Line(id="L1", text="Inside, the dragon was waiting.", bbox=BOX)],
)


def _store() -> InMemoryStore:
    return InMemoryStore(
        books={7: BookContext(id=7, title="The Grey Knight", setting_era="medieval England")},
        pages={(1, 7): [P11, P12, P13]},
    )


def test_grounding_keeps_cited_and_drops_uncited() -> None:
    known = {"p12:L2": "The portcullis groaned upward."}
    result = check_answer(
        "A portcullis is a heavy castle gate [p12:L2]. The dragon is inside. Want a picture?",
        known,
    )
    assert result.answer == "A portcullis is a heavy castle gate. Want a picture?"
    assert result.removed_sentences == ["The dragon is inside."]
    assert result.citations[0].line_id == "L2"


def test_grounding_rejects_unknown_page() -> None:
    result = check_answer("The dragon waits [p13:L1].", {"p12:L1": "x"})
    assert result.answer == ""


async def test_answer_with_tool_call_is_grounded() -> None:
    llm = FakeLLM(
        [ToolCall(id="c1", name="get_captured_pages", arguments='{"page_numbers": [11]}')],
        "He was very tired from riding [p11:L1]. Now he is at the castle [p12:L1].",
    )
    events: list[TraceEvent] = []

    async def sink(event: TraceEvent) -> None:
        events.append(event)

    result = await ask(
        question="Why is he tired?",
        user_id=1,
        book_id=7,
        store=_store(),
        current_page=P12,
        on_event=sink,
        llm=llm,
    )

    assert result.grounded
    assert result.tool_steps == 1
    assert "[" not in result.answer
    assert {c.page_id for c in result.citations} == {"p11", "p12"}
    assert [e.kind for e in events].count("tool_call") == 1
    # tool results go back to the model with the call id
    tool_msg = llm.calls[1]["messages"][-1]
    assert tool_msg.role == "tool" and tool_msg.tool_call_id == "c1"


async def test_future_pages_are_never_fetched() -> None:
    llm = FakeLLM(
        [ToolCall(id="c1", name="get_captured_pages", arguments="{}")],
        "The dragon is waiting [p13:L1].",
        "The pages you've read so far don't say [p12:L2].",
    )
    result = await ask(
        question="What is inside?", user_id=1, book_id=7, store=_store(), current_page=P12, llm=llm
    )
    tool_result = llm.calls[1]["messages"][-1].content
    assert "dragon" not in tool_result
    assert "dragon" not in result.answer
    assert result.answer == "The pages you've read so far don't say."


async def test_unfixable_answer_falls_back_safely() -> None:
    llm = FakeLLM("Something made up.", "Still made up.")
    result = await ask(
        question="?", user_id=1, book_id=7, store=_store(), current_page=P12, llm=llm
    )
    assert result.answer == NOT_IN_PAGES and not result.grounded


async def test_model_down_keeps_session_alive() -> None:
    result = await ask(
        question="?",
        user_id=1,
        book_id=7,
        store=_store(),
        current_page=P12,
        llm=FakeLLM(LLMError("timeout")),
    )
    assert result.answer == UNAVAILABLE


async def test_tool_loop_is_capped() -> None:
    call = [ToolCall(id="c", name="syllabify", arguments='{"word": "portcullis"}')]
    llm = FakeLLM(call, call, call, call, "A gate [p12:L2].")
    result = await ask(
        question="?", user_id=1, book_id=7, store=_store(), current_page=P12, llm=llm
    )
    assert result.tool_steps == 4
    assert llm.calls[-1].get("tools") is None
    assert result.answer == "A gate."


def test_page_order_sorts_front_matter_before_body() -> None:
    from app.brain.text_utils import page_order

    assert page_order("xiv") < page_order("1") < page_order("12") < page_order(13)
    assert page_order("iv") == (0, 4)
    assert page_order("Plate 3") is None
    assert CapturedPage(page_id="p1", page_number=12, lines=[]).page_number == "12"


async def test_captured_pages_never_beyond_current_page_label() -> None:
    from app.brain.tools import ToolContext, get_captured_pages

    preface = CapturedPage(page_id="p0", page_number="xii", lines=[])
    odd = CapturedPage(page_id="p9", page_number="Plate 3", lines=[])
    store = InMemoryStore(pages={(1, 7): [preface, P11, P12, P13, odd]})
    ctx = ToolContext(user_id=1, book_id=7, store=store, llm=FakeLLM(), current_page_number="12")
    result = await get_captured_pages(ctx)
    assert [p["page_id"] for p in result["pages"]] == ["p0", "p11", "p12", "p9"]

    only = await get_captured_pages(ctx, page_numbers=["XII", 11])
    assert [p["page_id"] for p in only["pages"]] == ["p0", "p11"]
