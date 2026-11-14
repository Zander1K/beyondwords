"""/speech: read-aloud and ask-by-voice through ElevenLabs. Thin layer over app.elevenlabs.

POST /speech/tts    text -> MP3 audio
POST /speech/stt    recorded audio (raw request body) -> text
GET  /speech/voices the voices to choose from

Raw audio in the body (not multipart) keeps the web app's upload to one fetch with no extra
dependency. On any failure the routes answer 503 "Speech is paused" (or 422 for nothing heard), so
the app can fall back to the browser's voices and reading carries on (SOP section 9).
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.elevenlabs.client import (
    ElevenLabsClient,
    SpeechError,
    SpeechErrorReason,
    get_elevenlabs_client,
)
from app.schemas.speech import SpeakRequest, SpeechVoice, SpeechVoices, TranscribeResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/speech", tags=["speech"])

Client = Annotated[ElevenLabsClient, Depends(get_elevenlabs_client)]

PAUSED_MESSAGE = "Speech is paused. Reading continues."
# A question is a few seconds of speech; this is generous, and stops oversized uploads early.
MAX_AUDIO_BYTES = 8 * 1024 * 1024


def _http_error(exc: SpeechError) -> HTTPException:
    if exc.reason is SpeechErrorReason.NO_SPEECH:
        return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "I didn't catch that.")
    logger.info("Speech unavailable (%s): %s", exc.reason.value, exc.detail)
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, PAUSED_MESSAGE)


@router.post(
    "/tts",
    response_class=Response,
    responses={200: {"content": {"audio/mpeg": {}}}, 503: {"description": PAUSED_MESSAGE}},
)
async def speak(body: SpeakRequest, client: Client) -> Response:
    try:
        audio = await client.tts(body.text, body.voice_id)
    except SpeechError as exc:
        raise _http_error(exc) from exc
    return Response(
        content=audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=3600"}
    )


@router.post(
    "/stt",
    response_model=TranscribeResponse,
    responses={422: {"description": "Nothing heard"}, 503: {"description": PAUSED_MESSAGE}},
)
async def transcribe(request: Request, client: Client) -> TranscribeResponse:
    audio = await request.body()
    if not audio:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "I didn't catch that.")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "That recording is too long.")
    content_type = request.headers.get("content-type", "audio/wav").split(";")[0].strip()
    try:
        text = await client.stt(audio, content_type or "audio/wav")
    except SpeechError as exc:
        raise _http_error(exc) from exc
    return TranscribeResponse(text=text)


@router.get("/voices", response_model=SpeechVoices)
async def voices(client: Client) -> SpeechVoices:
    try:
        found = await client.voices()
    except SpeechError as exc:
        raise _http_error(exc) from exc
    return SpeechVoices(
        default_voice_id=client.voice_id,
        voices=[
            SpeechVoice(
                id=v.id,
                name=v.name,
                description=v.description,
                category=v.category,
                preview_url=v.preview_url,
            )
            for v in found
        ],
    )
