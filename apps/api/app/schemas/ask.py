"""Request/response models for POST /ask (docs/gemini.md, "Conversation").

The phone turns the reader's speech into text, sends it here, and reads `answer` aloud through
the glasses with its own text-to-speech.
"""

from pydantic import BaseModel, Field


class PageLineIn(BaseModel):
    id: str = Field(max_length=32, examples=["L2"])
    text: str = Field(max_length=1000, examples=["The portcullis groaned upward."])


class AskRequest(BaseModel):
    question: str = Field(
        min_length=1,
        max_length=500,
        description="What the reader asked, as text (speech-to-text happens on the phone).",
        examples=["What does portcullis mean here?"],
    )
    session_id: str | None = Field(
        default=None,
        max_length=64,
        description="Send back the session_id from the previous answer to keep the conversation "
        "going (follow-up questions). Omit to start a new conversation.",
    )
    book_id: int | None = Field(
        default=None, description="From POST /books/identify, so answers fit the book."
    )
    page_lines: list[PageLineIn] = Field(
        default_factory=list,
        max_length=80,
        description="HACK: the current page's lines (id + text) until pages are stored "
        "server-side by POST /page.",
    )
    current_line_id: str | None = Field(
        default=None, max_length=32, description="The line the reader's finger is on."
    )
    user_id: int | None = Field(
        default=None,
        ge=1,
        description="The reader (users.id). When set, words they ask the meaning of go into "
        "their word bank. Optional until the phone has a sign-in step.",
    )
    pointed_word: str | None = Field(
        default=None,
        max_length=64,
        description="The word the reader is pointing at, as the phone picked it, so "
        '"what does this mean?" is about that word. Optional.',
        examples=["portcullis"],
    )


class AskResponse(BaseModel):
    session_id: str
    answer: str = Field(description="Two or three short sentences, written to be spoken aloud.")
    cited_lines: list[str] = Field(
        description="Line ids the answer is based on; every claim in `answer` cites one."
    )
    image_url: str | None = Field(
        description="Set when an illustration was made; GET it to show on the display."
    )
    used_brain: bool = Field(description="Always true: Nemotron answers every question.")
    tool_steps: list[str] = Field(description="Tools called, in order (for the trace screen).")
