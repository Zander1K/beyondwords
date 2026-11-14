"""Request/response models for /speech (ElevenLabs text-to-speech and speech-to-text)."""

from pydantic import BaseModel, Field


class SpeakRequest(BaseModel):
    text: str = Field(
        min_length=1,
        max_length=1500,
        description="What to say: a phrase, a word card, a short answer.",
    )
    voice_id: str | None = Field(
        default=None,
        max_length=64,
        description="From GET /speech/voices. Omit for the configured default.",
    )


class TranscribeResponse(BaseModel):
    text: str = Field(description="What the reader said.")


class SpeechVoice(BaseModel):
    id: str
    name: str
    description: str | None = None
    category: str | None = None
    preview_url: str | None = None


class SpeechVoices(BaseModel):
    default_voice_id: str
    voices: list[SpeechVoice]
