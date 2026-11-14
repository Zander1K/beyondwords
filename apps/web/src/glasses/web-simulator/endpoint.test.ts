import { describe, expect, it } from "vitest";

import { EndpointDetector, type EndpointStatus } from "./endpoint";

const RATE = 16000;

/** `seconds` of a steady tone at `level` (0-1 of full scale), or silence at 0. */
function tone(seconds: number, level: number): Int16Array {
  const n = Math.round(seconds * RATE);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(Math.sin(i / 8) * level * 32767);
  return out;
}

/** Feed pieces in 128-sample chunks (what the microphone worklet delivers). */
function run(det: EndpointDetector, pieces: Int16Array[]): EndpointStatus {
  let status: EndpointStatus = "waiting";
  for (const piece of pieces) {
    for (let i = 0; i < piece.length; i += 128) {
      status = det.push(piece.subarray(i, i + 128));
      if (status === "ended" || status === "no-speech") return status;
    }
  }
  return status;
}

describe("endpoint detector", () => {
  it("ends the question after speech then a pause", () => {
    expect(run(new EndpointDetector(RATE), [tone(0.4, 0.002), tone(2, 0.2), tone(2, 0.002)])).toBe(
      "ended",
    );
  });

  it("keeps waiting through a short pause in the middle of a sentence", () => {
    const status = run(new EndpointDetector(RATE), [
      tone(0.4, 0.002),
      tone(1, 0.2),
      tone(0.6, 0.002), // a breath: under the 1.2 s needed to end
      tone(1, 0.2),
    ]);
    expect(status).toBe("speaking");
  });

  it("gives up if nobody says anything", () => {
    expect(run(new EndpointDetector(RATE), [tone(8, 0.002)])).toBe("no-speech");
  });

  it("does not count a click or a cough as the start of a question", () => {
    // 60 ms of noise, then quiet: not enough speech to start, so it ends as no-speech.
    expect(
      run(new EndpointDetector(RATE), [tone(0.4, 0.002), tone(0.06, 0.3), tone(8, 0.002)]),
    ).toBe("no-speech");
  });

  it("adapts to a noisy room: steady background hiss is not speech, a voice above it is", () => {
    const noisy = 0.02; // above the quiet minimum, but steady
    const det = new EndpointDetector(RATE);
    expect(run(det, [tone(0.4, noisy), tone(1.5, 0.3), tone(2, noisy)])).toBe("ended");
  });

  it("stops at the maximum length, sending what was said", () => {
    expect(run(new EndpointDetector(RATE), [tone(0.4, 0.002), tone(25, 0.2)])).toBe("ended");
  });

  it("stays decided once it has decided", () => {
    const det = new EndpointDetector(RATE);
    run(det, [tone(0.4, 0.002), tone(1, 0.2), tone(2, 0.002)]);
    expect(det.push(tone(0.5, 0.5))).toBe("ended");
  });
});
