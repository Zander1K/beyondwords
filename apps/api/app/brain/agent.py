"""Reading-coach agent (SOP 8.2). Backs POST /ask and Gemini Live's ask_brain().

    result = await ask(
        question="What's a portcullis?",
        user_id=1, book_id=7, current_page=page_12, store=store,
        on_event=trace_ws.send,          # optional: WS /trace
    )
    result.answer          # plain text for Gemini Live / TTS
    result.citations       # lines it relied on

Loop: the model may call tools for up to `agent_max_tool_steps` (4) rounds, then must
answer. The answer goes through grounding.check_answer(); uncited sentences are removed,
and if nothing survives the model is re-asked once with the reason. If that also fails, a
safe "not in the pages so far" line is returned instead of an ungrounded answer.

Context is injected up front (book record, current page, previous captured page), so a good
answer never depends on a tool call firing.
"""

import json
import logging
import time
from collections.abc import Awaitable, Callable

from app.brain.grounding import GroundingResult, check_answer
from app.brain.llm import LLMClient, LLMError, Message, get_llm
from app.brain.prompts import load_prompt
from app.brain.settings import get_brain_settings
from app.brain.text_utils import correct_to_page_words
from app.brain.tools import TOOL_SPECS, ToolContext, get_book_context, run_tool
from app.brain.tools.store import BrainStore, Illustrator, NoIllustrator
from app.schemas.brain import AskResult, CapturedPage, PointedWord, TraceEvent

logger = logging.getLogger(__name__)

PROMPT_VERSION = "reading_coach.v2"
NOT_IN_PAGES = "I can't find that in the pages you've read so far. Want to read on and see?"
UNAVAILABLE = "Explanations are paused right now. Reading continues."

EventSink = Callable[[TraceEvent], Awaitable[None]]


async def _emit(sink: EventSink | None, event: TraceEvent) -> None:
    if sink is None:
        return
    try:
        await sink(event)
    except Exception:  # the trace screen must never break an answer
        logger.debug("trace sink failed", exc_info=True)


def _context_block(
    ctx: ToolContext,
    pages: list[CapturedPage],
    pointed: PointedWord | None,
    pointed_page_id: str | None,
) -> str:
    extra: dict = {}
    if pointed:
        extra["reader_is_pointing_at"] = {
            "word": pointed.word,
            "cite": f"{pointed_page_id}:{pointed.line_id}" if pointed_page_id else None,
            "sentence": pointed.sentence,
        }
    return json.dumps(
        {
            **extra,
            "book": ctx.book.model_dump(exclude_none=True) if ctx.book else None,
            "current_page_number": ctx.current_page_number,
            "captured_pages": [
                {
                    "page_id": p.page_id,
                    "page_number": p.page_number,
                    "lines": [{"cite": f"{p.page_id}:{ln.id}", "text": ln.text} for ln in p.lines],
                }
                for p in pages
            ],
        },
        ensure_ascii=False,
    )


def _rank(checked: GroundingResult) -> tuple[bool, int, int]:
    """Better answer: has text, fewer sentences dropped, more lines cited."""
    return (bool(checked.answer), -len(checked.removed_sentences), len(checked.citations))


async def ask(
    *,
    question: str,
    user_id: int,
    book_id: int | None,
    store: BrainStore,
    current_page: CapturedPage | None = None,
    extra_pages: list[CapturedPage] | None = None,
    illustrator: Illustrator | None = None,
    history: list[Message] | None = None,
    pointed: PointedWord | None = None,
    on_event: EventSink | None = None,
    llm: LLMClient | None = None,
) -> AskResult:
    """Answer one question, grounded in what this reader has captured.

    `current_page`: the page in front of the reader. `extra_pages`: other pages to inject
    (e.g. the previous page, or document lines in Everyday mode). `history`: earlier turns
    of this conversation as plain user/assistant messages, for follow-ups. `pointed`: the word
    the phone says the reader is pointing at, so "what does this mean?" is about that word.

    `question` may come straight from the phone's speech-to-text: page words it misheard
    ("port cullis", "century" for sentry) are put right before the model sees the question
    (text_utils.correct_to_page_words), so the answer is about the page's word and never
    comments on how the reader said it.
    """
    settings = get_brain_settings()
    llm = llm or get_llm()
    ctx = ToolContext(
        user_id=user_id,
        book_id=book_id,
        store=store,
        llm=llm,
        current_page_number=current_page.page_number if current_page else None,
        illustrator=illustrator or NoIllustrator(),
    )
    await get_book_context(ctx)
    injected = [*(extra_pages or []), *([current_page] if current_page else [])]
    ctx.remember(injected)
    asked, heard = correct_to_page_words(question, [ln.text for p in injected for ln in p.lines])
    if heard:
        await _emit(
            on_event, TraceEvent(kind="tool_result", name="heard_as", detail={"fixed": heard})
        )

    messages: list[Message] = [
        Message(role="system", content=load_prompt(PROMPT_VERSION)),
        Message(
            role="system",
            content="Context:\n"
            + _context_block(
                ctx,
                injected,
                pointed,
                current_page.page_id if current_page else None,
            ),
        ),
        *(history or []),
        Message(role="user", content=asked),
    ]

    started = time.perf_counter()
    try:
        text, steps = await _loop(messages, ctx, llm, settings.agent_max_tool_steps, on_event)
        checked = check_answer(text, ctx.known_lines, book_known=ctx.book is not None)
        await _emit(
            on_event,
            TraceEvent(
                kind="grounding",
                name="check_answer",
                detail={"kept": len(checked.citations), "removed": checked.removed_sentences},
            ),
        )

        if not checked.answer or checked.removed_sentences:
            # One re-ask (SOP 8.2) when nothing survived the check or a sentence had to be
            # dropped (often a correct word meaning that just lacked its citation).
            missing = " ".join(f'"{s}"' for s in checked.removed_sentences)
            messages += [
                Message(role="assistant", content=text),
                Message(
                    role="user",
                    content=(
                        "Every sentence needs a citation to a captured line like [p12:L2] or "
                        "[book]. "
                        + (f"These had none: {missing} " if missing else "")
                        + "Rewrite the answer in two or three sentences using only the "
                        "captured pages, or say it is not in the pages read so far."
                    ),
                ),
            ]
            first = checked
            try:
                text, more = await _loop(messages, ctx, llm, 0, on_event)
                steps += more
                retry = check_answer(text, ctx.known_lines, book_known=ctx.book is not None)
                if _rank(retry) > _rank(first):
                    checked = retry
            except LLMError:
                if not first.answer:
                    raise
                # keep the first answer's grounded sentences rather than going silent
    except LLMError as exc:
        logger.warning("Agent unavailable: %s", exc)
        await _emit(on_event, TraceEvent(kind="error", name="llm", detail={"error": str(exc)}))
        return AskResult(answer=UNAVAILABLE, answer_with_citations=UNAVAILABLE, grounded=False)

    if not checked.answer:
        result = AskResult(
            answer=NOT_IN_PAGES,
            answer_with_citations=NOT_IN_PAGES,
            grounded=False,
            removed_sentences=checked.removed_sentences,
            tool_steps=steps,
        )
    else:
        result = AskResult(
            answer=checked.answer,
            answer_with_citations=checked.answer_with_citations,
            citations=checked.citations,
            image_url=ctx.image_url,
            grounded=checked.grounded,
            removed_sentences=checked.removed_sentences,
            tool_steps=steps,
        )
    await _emit(
        on_event,
        TraceEvent(
            kind="answer",
            name="ask",
            ms=int((time.perf_counter() - started) * 1000),
            detail={"answer": result.answer_with_citations, "grounded": result.grounded},
        ),
    )
    return result


async def _loop(
    messages: list[Message],
    ctx: ToolContext,
    llm: LLMClient,
    max_steps: int,
    on_event: EventSink | None,
) -> tuple[str, int]:
    """Run tool rounds, mutating `messages`. Returns (final text, tool rounds used)."""
    settings = get_brain_settings()
    steps = 0
    while True:
        allow_tools = steps < max_steps
        reply = await llm.chat(
            messages,
            max_tokens=600,
            temperature=0.3,
            reasoning=settings.ask_reasoning,
            tools=TOOL_SPECS if allow_tools else None,
            timeout_s=settings.ask_timeout_s,
        )
        await _emit(
            on_event,
            TraceEvent(
                kind="llm_call",
                name=reply.model,
                ms=reply.latency_ms,
                detail={"tool_calls": [c.name for c in reply.tool_calls]},
            ),
        )
        if not reply.tool_calls or not allow_tools:
            return reply.text.strip(), steps

        steps += 1
        messages.append(
            Message(role="assistant", content=reply.text or None, tool_calls=reply.tool_calls)
        )
        for call in reply.tool_calls:
            await _emit(
                on_event,
                TraceEvent(
                    kind="tool_call", name=call.name, detail={"arguments": call.arguments[:500]}
                ),
            )
            started = time.perf_counter()
            result = await run_tool(ctx, call.name, call.arguments)
            await _emit(
                on_event,
                TraceEvent(
                    kind="tool_result",
                    name=call.name,
                    ms=int((time.perf_counter() - started) * 1000),
                    detail={"keys": sorted(result)},
                ),
            )
            messages.append(
                Message(
                    role="tool",
                    tool_call_id=call.id,
                    content=json.dumps(result, ensure_ascii=False)[:12000],
                )
            )


async def ask_brain(question: str, **session: object) -> str:
    """Gemini Live tool entry point: same as ask(), returns only the text to speak.

    Mick Ola's Live bridge binds the session (user_id, book_id, store, current_page, ...)
    and passes them as keyword arguments.
    """
    result = await ask(question=question, **session)  # type: ignore[arg-type]
    return result.answer
