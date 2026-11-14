// ElevenLabs speech through our API (never directly: the API key stays on the server).
//   GET  /speech/voices  the voices to choose from
//   POST /speech/tts     text -> MP3 audio
//   POST /speech/stt     recorded audio (WAV) -> text
// Every function throws SpeechHttpError on failure so callers can fall back (browser voices) or
// say what went wrong; none of them ever needs to crash a reading session.
import { API_BASE_URL } from "@/config";

export interface RemoteVoice {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
}

export class SpeechHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SpeechHttpError";
    this.status = status;
  }
}

/** Voice ids from ElevenLabs are stored with this prefix, to tell them from browser voices. */
export const REMOTE_PREFIX = "el:";

async function check(response: Response, what: string): Promise<Response> {
  if (!response.ok)
    throw new SpeechHttpError(response.status, `${what} failed with ${response.status}`);
  return response;
}

export async function fetchSpeechVoices(signal?: AbortSignal): Promise<RemoteVoice[]> {
  const r = await check(
    await fetch(`${API_BASE_URL}/speech/voices`, {
      headers: { Accept: "application/json" },
      signal,
    }),
    "GET /speech/voices",
  );
  const body = (await r.json()) as { voices?: RemoteVoice[] };
  return (body.voices ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description ?? null,
    category: v.category ?? null,
  }));
}

/** The text spoken, as an audio Blob. `voiceId` is the ElevenLabs id (no prefix), or null. */
export async function fetchSpeech(
  text: string,
  voiceId: string | null,
  signal?: AbortSignal,
): Promise<Blob> {
  const r = await check(
    await fetch(`${API_BASE_URL}/speech/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ...(voiceId ? { voice_id: voiceId } : {}) }),
      signal,
    }),
    "POST /speech/tts",
  );
  return r.blob();
}

/** What was said in a recording. A 422 means nothing was heard. */
export async function transcribeAudio(audio: Blob, signal?: AbortSignal): Promise<string> {
  const r = await check(
    await fetch(`${API_BASE_URL}/speech/stt`, {
      method: "POST",
      headers: { "Content-Type": audio.type || "audio/wav" },
      body: audio,
      signal,
    }),
    "POST /speech/stt",
  );
  const body = (await r.json()) as { text?: string };
  return (body.text ?? "").trim();
}
