"""Reader questions for POST /ask: Nemotron answers, grounded in the page, with follow-ups.

    reply = await get_question_service().ask(
        "what does port cullis mean",
        book=book,
        page_lines=[("L1", "..."), ("L2", "...")],
        current_line_id="L2",
        session_id=previous_reply.session_id,
    )
    reply.answer       # two or three short sentences for the phone's text-to-speech
    reply.cited_lines  # ["L2"]: lines the answer is based on

The phone does speech-to-text, sends the question here and speaks `answer`. Misheard page words
are fixed in code first. Then:

- "What does X mean?" (or "what does this mean?" while pointing) about a word on the page goes
  straight to define_word: Nemotron's meaning in this sentence and this book, citing the line.
  Live tests showed the agent sometimes refusing plain word meanings in a famous book ("the
  pages don't define it"), so word meanings no longer depend on the agent's judgement.
- Everything else goes to the reading-coach agent (agent.ask): tool steps, a citation for every
  claim, uncited or spoiler claims removed before the reader hears them.

Sessions keep the last few question/answer turns in memory so "and why did he do that?" works;
they are forgotten after `ttl_seconds` idle and never stored.

HACK: the phone sends the current page's lines with each question until POST /page stores
pages server-side. Until then answers can only draw on the current page, and nothing reaches
the word bank (no user id yet).
"""

import asyncio
import re
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from functools import lru_cache

from app.brain import agent
from app.brain.llm import LLMClient, LLMError, Message
from app.brain.text_utils import correct_to_page_words, letters
from app.brain.tools.define import define_word
from app.brain.tools.store import Illustrator, InMemoryStore
from app.config import get_settings
from app.schemas.brain import BookContext, CapturedPage, PointedWord, TraceEvent
from app.schemas.page import Line

# Page id used in citations for the page the phone sent ("[page:L2]").
CURRENT_PAGE_ID = "page"
TURNS_KEPT = 4  # earlier question/answer pairs sent back for follow-ups
_NO_BOX = [0.0, 0.0, 0.0, 0.0]  # the phone sends line text only; boxes are not needed here


_FILLER = re.compile(
    r"^(?:(?:um+|uh+|so|ok(?:ay)?|hey|sorry|and|please|(?:can|could) you(?: tell me| explain)?"
    r"|tell me|i (?:don'?t|do not) (?:know|understand|get))\s+)+"
    r"|\s+(?:here|please|again|in this sentence|on this page|in this book)$"
)
_WORD = r"(?P<w>[\w'’-]+)"
_MEANING_QUESTIONS = [
    re.compile(p)
    for p in (
        rf"what (?:does|do|did) (?:the word )?{_WORD}(?: word)? mean",
        rf"what(?:'s|s| s| is)? (?:the word )?{_WORD}(?: word)? means?",
        rf"what(?: is|'s|s| s) (?:the )?(?:meaning of )?(?:the word )?(?:an? )?{_WORD}(?: word)?",
        rf"(?:the )?meaning of (?:the word )?{_WORD}",
        rf"(?:define|explain|meaning) (?:the word )?{_WORD}",
        rf"{_WORD} mean(?:s|ing)?",
    )
]
# Just the word, e.g. what is left of "I don't understand aloof".
_BARE_WORD = re.compile(rf"(?:the word )?{_WORD}")
_MEANING_QUESTIONS.append(_BARE_WORD)
_THIS = {"this", "that", "it"}
_NOT_WORDS = {"he", "she", "they", "him", "her", "them", "his", "going", "happening", "happened"}


def meaning_target(
    question: str,
    page_lines: list[tuple[str, str]],
    pointed_word: str | None = None,
    current_line_id: str | None = None,
) -> tuple[str, str, str] | None:
    """(word as printed, line id, line text) when the question just asks what a word on the
    page means; None for anything else (story questions go to the agent)."""
    q = re.sub(r"[^\w\s'’-]", " ", question.lower())
    q = " ".join(q.split())
    q = _FILLER.sub("", q).strip()
    match = next((m for p in _MEANING_QUESTIONS if (m := p.fullmatch(q))), None)
    if match is None:
        return None
    word = match.group("w")
    if word in _THIS:
        if not pointed_word:
            return None
        word = pointed_word
    if len(letters(word)) < 3 or word in _NOT_WORDS:
        return None
    ordered = sorted(page_lines, key=lambda line: line[0] != current_line_id)
    for line_id, text in ordered:
        for token in re.findall(r"[\w'’-]+", text):
            if letters(token) == letters(word):
                if match.re is _BARE_WORD and token[:1].isupper():
                    return None  # a name on its own ("Darcy") is a story question, not a word
                return token.strip("'’-"), line_id, text
    if pointed_word and word == pointed_word and current_line_id:
        return pointed_word, current_line_id, dict(page_lines).get(current_line_id, "")
    return None


class QuestionUnavailableError(Exception):
    """Nemotron is down or too slow: the phone says "Explanations are paused"."""


@dataclass
class QuestionReply:
    session_id: str
    answer: str
    cited_lines: list[str]
    image_url: str | None
    tool_steps: list[str]  # tool names in order, for the trace screen
    grounded: bool


@dataclass
class _Session:
    history: list[Message] = field(default_factory=list)
    updated_at: float = field(default_factory=time.monotonic)


class QuestionService:
    def __init__(
        self,
        *,
        timeout_seconds: float,
        session_ttl_seconds: float,
        max_sessions: int = 500,
        llm: LLMClient | None = None,
    ) -> None:
        self._timeout = timeout_seconds
        self._ttl = session_ttl_seconds
        self._max_sessions = max_sessions
        self._llm = llm  # None: agent uses get_llm() (Verda, NVIDIA Build fallback)
        self._sessions: OrderedDict[str, _Session] = OrderedDict()

    def end_session(self, session_id: str) -> None:
        """Forget a conversation now (e.g. the reader closes the book)."""
        self._sessions.pop(session_id, None)

    async def ask(
        self,
        question: str,
        *,
        book: BookContext | None = None,
        page_lines: list[tuple[str, str]] | None = None,
        current_line_id: str | None = None,
        pointed_word: str | None = None,
        session_id: str | None = None,
        illustrator: Illustrator | None = None,
        user_id: int = 0,
    ) -> QuestionReply:
        """Raises QuestionUnavailableError when Nemotron cannot answer in time."""
        session_id, session = self._session(session_id)
        lines = [Line(id=line_id, text=text, bbox=_NO_BOX) for line_id, text in page_lines or []]
        page = CapturedPage(page_id=CURRENT_PAGE_ID, lines=lines)
        book_id = book.id if book and book.id is not None else (0 if book else None)
        store = InMemoryStore(
            books={book_id: book} if book and book_id is not None else {},
            pages={(user_id, book_id): [page]} if book_id is not None else {},
        )
        pointed = None
        if current_line_id or pointed_word:
            by_id = dict(page_lines or [])
            pointed = PointedWord(
                word=pointed_word,
                line_id=current_line_id or "",
                sentence=by_id.get(current_line_id or ""),
            )
        steps: list[str] = []
        asked, _ = correct_to_page_words(question, [text for _, text in page_lines or []])
        target = meaning_target(asked, page_lines or [], pointed_word, current_line_id)
        if target is not None:
            word, line_id, sentence = target
            try:
                breakdown = await asyncio.wait_for(
                    define_word(word, sentence, book, llm=self._llm), timeout=self._timeout
                )
            except (TimeoutError, LLMError) as exc:
                raise QuestionUnavailableError("Nemotron could not define the word") from exc
            await store.add_to_word_bank(user_id, book_id, word, sentence, CURRENT_PAGE_ID)
            meaning = breakdown.meaning.strip().rstrip(".")
            answer = f"{word[:1].upper()}{word[1:]} means {meaning[:1].lower()}{meaning[1:]}."
            self._remember(session, question, answer)
            return QuestionReply(
                session_id=session_id,
                answer=answer,
                cited_lines=[line_id],
                image_url=None,
                tool_steps=["define"],
                grounded=True,
            )

        async def trace(event: TraceEvent) -> None:
            if event.kind == "tool_call":
                steps.append(event.name)

        try:
            result = await asyncio.wait_for(
                agent.ask(
                    question=question,
                    user_id=user_id,
                    book_id=book_id,
                    store=store,
                    current_page=page if lines else None,
                    illustrator=illustrator,
                    history=list(session.history),
                    pointed=pointed,
                    on_event=trace,
                    llm=self._llm,
                ),
                timeout=self._timeout,
            )
        except TimeoutError as exc:
            raise QuestionUnavailableError("Nemotron did not answer in time") from exc
        if result.answer == agent.UNAVAILABLE:
            raise QuestionUnavailableError("Nemotron unavailable")

        self._remember(session, question, result.answer)
        cited: list[str] = []
        for c in result.citations:
            if c.page_id == CURRENT_PAGE_ID and c.line_id not in cited:
                cited.append(c.line_id)
        return QuestionReply(
            session_id=session_id,
            answer=result.answer,
            cited_lines=cited,
            image_url=result.image_url,
            tool_steps=steps,
            grounded=result.grounded,
        )

    def _remember(self, session: _Session, question: str, answer: str) -> None:
        session.history += [
            Message(role="user", content=question),
            Message(role="assistant", content=answer),
        ]
        del session.history[: -2 * TURNS_KEPT]
        session.updated_at = time.monotonic()

    def _session(self, session_id: str | None) -> tuple[str, _Session]:
        now = time.monotonic()
        for sid in [s for s, v in self._sessions.items() if now - v.updated_at > self._ttl]:
            del self._sessions[sid]
        session_id = session_id or uuid.uuid4().hex
        session = self._sessions.get(session_id)
        if session is None:
            session = self._sessions[session_id] = _Session()
            while len(self._sessions) > self._max_sessions:
                self._sessions.popitem(last=False)
        self._sessions.move_to_end(session_id)
        return session_id, session


@lru_cache
def get_question_service() -> QuestionService:
    """FastAPI dependency (override in tests via app.dependency_overrides)."""
    settings = get_settings()
    return QuestionService(
        timeout_seconds=settings.brain_timeout_seconds,
        session_ttl_seconds=settings.conversation_ttl_seconds,
    )
