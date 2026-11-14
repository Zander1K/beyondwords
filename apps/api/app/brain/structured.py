"""Ask Nemotron for JSON that must match a Pydantic model (SOP 8.1 and 11, technique 1).

    result = await chat_json(llm, messages, PageAnalysisDraft, timeout_s=30)

Flow: request JSON (vLLM `response_format` with the model's JSON schema) -> extract the JSON
object from the reply -> validate with Pydantic -> on failure, one automatic retry that tells
the model what was wrong. If the endpoint rejects `response_format` (HTTP 400), the call is
repeated once without it and validation does the work.
"""

import json
import logging
import re
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.brain.llm import LLMClient, LLMError, Message

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


class StructuredOutputError(LLMError):
    """The model kept returning output that does not match the schema."""

    def __init__(self, message: str):
        super().__init__(message, retryable=False)


def extract_json(text: str) -> Any:
    """Parse the first JSON object in `text`, tolerating code fences and stray prose."""
    cleaned = _FENCE.sub("", text.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(cleaned[start : end + 1])


def _schema_format(model: type[BaseModel]) -> dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {"name": model.__name__, "schema": model.model_json_schema()},
    }


async def chat_json(
    llm: LLMClient,
    messages: list[Message],
    model: type[T],
    *,
    max_tokens: int = 4096,
    reasoning: bool = False,
    timeout_s: float | None = None,
    use_schema: bool = True,
) -> T:
    kwargs: dict[str, Any] = {
        "max_tokens": max_tokens,
        "reasoning": reasoning,
        "temperature": 0.1,
        "timeout_s": timeout_s,
    }
    if use_schema:
        kwargs["response_format"] = _schema_format(model)

    convo = list(messages)
    last_error = ""
    for attempt in range(2):  # first try + one automatic retry (SOP 8.1)
        try:
            reply = await llm.chat(convo, **kwargs)
        except LLMError as exc:
            if exc.status == 400 and "response_format" in kwargs:
                logger.info("Endpoint rejected response_format; retrying without it")
                kwargs.pop("response_format")
                reply = await llm.chat(convo, **kwargs)
            else:
                raise
        try:
            return model.model_validate(extract_json(reply.text))
        except (json.JSONDecodeError, ValidationError) as exc:
            last_error = str(exc)[:1500]
            logger.info("Structured output invalid (attempt %d): %s", attempt + 1, last_error[:200])
            convo = [
                *messages,
                Message(role="assistant", content=reply.text[:6000]),
                Message(
                    role="user",
                    content=(
                        "That output was not valid. Fix these problems and reply with only the "
                        f"corrected JSON object, no prose:\n{last_error}"
                    ),
                ),
            ]
    raise StructuredOutputError(f"{model.__name__} output invalid after retry: {last_error[:300]}")
