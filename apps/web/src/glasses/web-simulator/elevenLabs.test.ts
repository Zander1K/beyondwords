import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSpeech, fetchSpeechVoices, SpeechHttpError, transcribeAudio } from "./elevenLabs";

const ok = (body: unknown, blob?: Blob) =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    blob: async () => blob ?? new Blob(),
  });
const fail = (status: number) => vi.fn().mockResolvedValue({ ok: false, status });

afterEach(() => vi.unstubAllGlobals());

describe("ElevenLabs through our API", () => {
  it("lists voices", async () => {
    vi.stubGlobal("fetch", ok({ voices: [{ id: "v1", name: "George" }] }));
    expect(await fetchSpeechVoices()).toEqual([
      { id: "v1", name: "George", description: null, category: null },
    ]);
  });

  it("asks for speech with the text and an optional voice", async () => {
    const f = ok({}, new Blob(["mp3"]));
    vi.stubGlobal("fetch", f);
    expect((await fetchSpeech("Hello", "v1")).size).toBe(3);
    expect(f.mock.calls[0]?.[0]).toBe("/api/speech/tts");
    expect(JSON.parse(f.mock.calls[0]?.[1].body)).toEqual({ text: "Hello", voice_id: "v1" });
    await fetchSpeech("Hello", null);
    expect(JSON.parse(f.mock.calls[1]?.[1].body)).toEqual({ text: "Hello" });
  });

  it("sends the recording as the raw body and returns the text", async () => {
    const f = ok({ text: "  what is a portcullis  " });
    vi.stubGlobal("fetch", f);
    const wav = new Blob(["RIFF"], { type: "audio/wav" });
    expect(await transcribeAudio(wav)).toBe("what is a portcullis");
    expect(f.mock.calls[0]?.[1].body).toBe(wav);
    expect(f.mock.calls[0]?.[1].headers["Content-Type"]).toBe("audio/wav");
  });

  it("throws a SpeechHttpError with the status, so callers can fall back", async () => {
    vi.stubGlobal("fetch", fail(503));
    await expect(fetchSpeech("x", null)).rejects.toMatchObject({ status: 503 });
    vi.stubGlobal("fetch", fail(422));
    const error = await transcribeAudio(new Blob(["x"])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpeechHttpError);
    expect((error as SpeechHttpError).status).toBe(422);
  });
});
