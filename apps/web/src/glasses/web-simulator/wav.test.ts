import { describe, expect, it } from "vitest";

import { durationSeconds, encodeWavBytes } from "./wav";

describe("wav", () => {
  it("writes a valid 16-bit mono header and the samples", () => {
    const wav = encodeWavBytes([Int16Array.of(1, -2, 3), Int16Array.of(4)], 16000);
    const v = new DataView(wav.buffer);
    const tag = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(wav.length).toBe(44 + 4 * 2);
    expect(v.getUint32(4, true)).toBe(wav.length - 8);
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect([44, 46, 48, 50].map((o) => v.getInt16(o, true))).toEqual([1, -2, 3, 4]);
  });

  it("measures duration", () => {
    expect(durationSeconds([new Int16Array(8000), new Int16Array(8000)], 16000)).toBe(1);
    expect(durationSeconds([], 16000)).toBe(0);
    expect(durationSeconds([new Int16Array(10)], 0)).toBe(0);
  });
});
