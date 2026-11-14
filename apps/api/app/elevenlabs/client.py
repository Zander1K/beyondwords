"""A small async client for the ElevenLabs REST API (text-to-speech, speech-to-text, voices).

Privacy (CLAUDE.md section 10): the text to speak and the recorded question are sent to
ElevenLabs to be processed. Nothing here stores audio; the only cache is of generated speech for
repeated phrases, held in memory.

Failures raise `SpeechError` with a reason, so the router can say "speech is paused" and the app
can fall back to the browser's own voices instead of crashing a reading session.
"""

import logging
from collections import OrderedDict
from dataclasses import dataclass
from enum import StrEnum
from functools import lru_cache

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

BASE_URL = "https://api.elevenlabs.io"
# Cached generated speech: phrases get read again (reopening a card, a repeated word).
CACHE_SIZE = 128
MP3 = "mp3_44100_128"
# ElevenLabs' stock "George" (warm storyteller): a premade voice every account has. Used when
# ELEVENLABS_VOICE_ID is blank.
DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"


class SpeechErrorReason(StrEnum):
    NOT_CONFIGURED = "not_configured"  # no API key
    UNAUTHORIZED = "unauthorized"  # key rejected
    RATE_LIMITED = "rate_limited"  # quota or too many requests
    TIMEOUT = "timeout"
    NO_SPEECH = "no_speech"  # speech-to-text heard nothing
    FAILED = "failed"


class SpeechError(Exception):
    def __init__(self, reason: SpeechErrorReason, detail: str = "") -> None:
        super().__init__(detail or reason.value)
        self.reason = reason
        self.detail = detail or reason.value


@dataclass(frozen=True)
class Voice:
    id: str
    name: str
    description: str | None
    category: str | None
    preview_url: str | None


class ElevenLabsClient:
    def __init__(
        self,
        *,
        api_key: str,
        voice_id: str,
        tts_model: str,
        stt_model: str,
        timeout: float = 15.0,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self._key = api_key
        self.voice_id = voice_id
        self._tts_model = tts_model
        self._stt_model = stt_model
        self._http = http or httpx.AsyncClient(base_url=BASE_URL, timeout=timeout)
        self._cache: OrderedDict[tuple[str, str, str], bytes] = OrderedDict()

    @property
    def configured(self) -> bool:
        return bool(self._key)

    async def _request(self, method: str, path: str, **kwargs: object) -> httpx.Response:
        if not self._key:
            raise SpeechError(SpeechErrorReason.NOT_CONFIGURED, "ELEVENLABS_API_KEY is not set")
        headers = {"xi-api-key": self._key}
        try:
            response = await self._http.request(method, path, headers=headers, **kwargs)  # type: ignore[arg-type]
        except httpx.TimeoutException as exc:
            raise SpeechError(SpeechErrorReason.TIMEOUT) from exc
        except httpx.HTTPError as exc:
            raise SpeechError(SpeechErrorReason.FAILED, str(exc)) from exc
        if response.status_code in (401, 403):
            raise SpeechError(SpeechErrorReason.UNAUTHORIZED)
        if response.status_code == 429:
            raise SpeechError(SpeechErrorReason.RATE_LIMITED)
        if response.status_code >= 400:
            # Never log the key; the body explains most problems (quota, unknown voice).
            logger.warning(
                "ElevenLabs %s %s -> %s %s", method, path, response.status_code, response.text[:200]
            )
            raise SpeechError(
                SpeechErrorReason.FAILED, f"ElevenLabs answered {response.status_code}"
            )
        return response

    async def tts(self, text: str, voice_id: str | None = None) -> bytes:
        """The text spoken, as MP3 bytes. Repeated (text, voice) pairs come from memory."""
        voice = voice_id or self.voice_id
        key = (voice, self._tts_model, text)
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        response = await self._request(
            "POST",
            f"/v1/text-to-speech/{voice}",
            params={"output_format": MP3},
            json={"text": text, "model_id": self._tts_model},
        )
        self._cache[key] = response.content
        while len(self._cache) > CACHE_SIZE:
            self._cache.popitem(last=False)
        return response.content

    async def stt(
        self, audio: bytes, content_type: str = "audio/wav", language: str | None = None
    ) -> str:
        """What was said in `audio`, as text. Raises NO_SPEECH when nothing was heard."""
        data = {"model_id": self._stt_model}
        if language:
            data["language_code"] = language
        response = await self._request(
            "POST",
            "/v1/speech-to-text",
            data=data,
            files={"file": ("question", audio, content_type)},
        )
        text = str(response.json().get("text", "")).strip()
        if not text:
            raise SpeechError(SpeechErrorReason.NO_SPEECH, "No speech heard")
        return text

    async def voices(self) -> list[Voice]:
        response = await self._request("GET", "/v1/voices")
        return [
            Voice(
                id=v["voice_id"],
                name=v.get("name", ""),
                description=(v.get("labels") or {}).get("descriptive") or v.get("description"),
                category=v.get("category"),
                preview_url=v.get("preview_url"),
            )
            for v in response.json().get("voices", [])
        ]


@lru_cache
def get_elevenlabs_client() -> ElevenLabsClient:
    s = get_settings()
    return ElevenLabsClient(
        api_key=s.elevenlabs_api_key,
        voice_id=s.elevenlabs_voice_id.strip() or DEFAULT_VOICE_ID,
        tts_model=s.elevenlabs_tts_model,
        stt_model=s.elevenlabs_stt_model,
        timeout=s.elevenlabs_timeout_seconds,
    )
