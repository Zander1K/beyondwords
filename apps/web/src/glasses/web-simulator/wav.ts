// Recorded microphone audio as a WAV file, which speech-to-text services accept. The microphone
// gives raw 16-bit mono samples (GlassesAdapter.startMic); a WAV is those samples behind a
// 44-byte header. Pure, no browser APIs.

/** Seconds of audio in the chunks at `sampleRate`. */
export function durationSeconds(chunks: readonly Int16Array[], sampleRate: number): number {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  return sampleRate > 0 ? samples / sampleRate : 0;
}

/** A 16-bit mono PCM WAV (as bytes) from sample chunks. */
export function encodeWavBytes(
  chunks: readonly Int16Array[],
  sampleRate: number,
): Uint8Array<ArrayBuffer> {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const dataBytes = samples * 2;
  const out = new Uint8Array(new ArrayBuffer(44 + dataBytes));
  const view = new DataView(out.buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  let at = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++, at += 2) view.setInt16(at, chunk[i] ?? 0, true);
  }
  return out;
}
