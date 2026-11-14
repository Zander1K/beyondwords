import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HEALTHY_MS, MAX_FAILURES, WakeWordListener, type WakeProblem } from "./wakeWord";

/** A stand-in for the browser's SpeechRecognition that the test drives by hand. */
class FakeRecognition {
  static all: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  onstart: (() => void) | null = null;
  onresult: ((e: { resultIndex: number; results: unknown[][] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  aborted = false;
  constructor() {
    FakeRecognition.all.push(this);
  }
  start() {
    this.started += 1;
    this.onstart?.();
  }
  stop() {
    this.aborted = true;
  }
  abort() {
    this.aborted = true;
  }
  say(text: string) {
    this.onresult?.({ resultIndex: 0, results: [[{ transcript: text }]] });
  }
  endNow() {
    this.onend?.();
  }
}

const latest = () => FakeRecognition.all[FakeRecognition.all.length - 1] as FakeRecognition;

describe("WakeWordListener", () => {
  let woke: number;
  let problems: [WakeProblem, string][];
  const make = () =>
    new WakeWordListener(
      () => (woke += 1),
      (p, d) => problems.push([p, d]),
    );

  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecognition.all = [];
    woke = 0;
    problems = [];
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("wakes on the phrase and lets go of the microphone", () => {
    const l = make();
    l.start();
    latest().say("what a day");
    expect(woke).toBe(0);
    const rec = latest();
    rec.say("hey meta");
    expect(woke).toBe(1);
    expect(rec.aborted).toBe(true);
    vi.advanceTimersByTime(20_000);
    expect(FakeRecognition.all).toHaveLength(1); // it does not listen again by itself
  });

  it("keeps listening when the browser ends a session (it does that now and then)", () => {
    make().start();
    vi.advanceTimersByTime(HEALTHY_MS + 100); // it ran a good while
    latest().endNow();
    vi.advanceTimersByTime(400);
    expect(FakeRecognition.all).toHaveLength(2);
    expect(problems).toEqual([]);
  });

  it("does not switch off on a temporary network error: it backs off and tries again", () => {
    make().start();
    latest().onerror?.({ error: "network" });
    latest().endNow();
    expect(FakeRecognition.all).toHaveLength(1); // waits before trying again
    vi.advanceTimersByTime(1100);
    expect(FakeRecognition.all).toHaveLength(2);
    expect(problems).toEqual([]);
  });

  it("recovers: one good session clears the failures", () => {
    make().start();
    for (let i = 0; i < MAX_FAILURES - 1; i++) {
      latest().onerror?.({ error: "network" });
      latest().endNow();
      vi.runOnlyPendingTimers(); // the retry, without letting time pass
    }
    vi.advanceTimersByTime(HEALTHY_MS + 100);
    latest().endNow(); // this one ran long enough: healthy
    vi.advanceTimersByTime(400);
    latest().onerror?.({ error: "network" });
    latest().endNow();
    vi.runOnlyPendingTimers();
    expect(problems).toEqual([]);
  });

  it("gives up, and says why, after failing over and over (for example a blocked service)", () => {
    make().start();
    for (let i = 0; i < MAX_FAILURES + 1 && problems.length === 0; i++) {
      latest().onerror?.({ error: "network" });
      latest().endNow();
      vi.runOnlyPendingTimers();
    }
    expect(problems).toEqual([["unavailable", "network"]]);
  });

  it("stops at once when the microphone is blocked", () => {
    make().start();
    latest().onerror?.({ error: "not-allowed" });
    expect(problems).toEqual([["denied", "not-allowed"]]);
    vi.advanceTimersByTime(60_000);
    expect(FakeRecognition.all).toHaveLength(1);
  });

  it("does not switch off when starting throws once (an already-started race)", () => {
    const l = make();
    const original = FakeRecognition.prototype.start;
    FakeRecognition.prototype.start = function () {
      FakeRecognition.prototype.start = original;
      throw new DOMException("already started", "InvalidStateError");
    };
    l.start();
    expect(problems).toEqual([]);
    vi.advanceTimersByTime(1100);
    expect(FakeRecognition.all).toHaveLength(2);
    expect(latest().started).toBe(1);
  });

  it("reports an unsupported browser", () => {
    vi.stubGlobal("window", {});
    make().start();
    expect(problems[0]?.[0]).toBe("unsupported");
  });

  it("stop() stops for good", () => {
    const l = make();
    l.start();
    l.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeRecognition.all).toHaveLength(1);
  });
});
