import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GlassesGesture, SessionEvent } from "../adapter";
import { DIM_BEFORE_SLEEP_MS, WebSimulatorAdapter } from "./WebSimulatorAdapter";

function setup() {
  const adapter = new WebSimulatorAdapter({
    keyTarget: new EventTarget(),
    startDelayMs: 0,
    stopDelayMs: 0,
    sleepTimeoutMs: 1000,
    warn: () => {},
  });
  const events: SessionEvent[] = [];
  const gestures: GlassesGesture[] = [];
  adapter.onSessionEvent((e) => events.push(e));
  adapter.onGesture((g) => gestures.push(g));
  return { adapter, events, gestures };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function start(adapter: WebSimulatorAdapter) {
  const started = adapter.session.start();
  await vi.runOnlyPendingTimersAsync();
  await started;
}

describe("SIM-SES-03 interrupt and resume", () => {
  it("stops the session and clears the display, then restarts on resume", async () => {
    const { adapter, events } = setup();
    await start(adapter);
    adapter.showPhrase("The old lighthouse");

    const interrupted = adapter.interrupt();
    expect(adapter.store.getState().content).toBeNull();
    await vi.runOnlyPendingTimersAsync();
    await interrupted;
    expect(adapter.session.state).toBe("stopped");

    const resumed = adapter.resume();
    await vi.runOnlyPendingTimersAsync();
    await resumed;
    expect(adapter.session.state).toBe("started");
    expect(events).toEqual(["interrupted", "resumed"]);
    adapter.dispose();
  });
});

describe("SIM-SES-04 sleep and wake", () => {
  it("dims after the idle timeout, then sleeps", async () => {
    const { adapter, events } = setup();
    await start(adapter);
    vi.advanceTimersByTime(1000);
    expect(adapter.store.getState().sleep).toBe("dimmed");
    vi.advanceTimersByTime(DIM_BEFORE_SLEEP_MS);
    expect(adapter.store.getState().sleep).toBe("asleep");
    expect(events).toEqual(["slept"]);
    adapter.dispose();
  });

  it("any gesture resets the idle timer", async () => {
    const { adapter } = setup();
    await start(adapter);
    vi.advanceTimersByTime(900);
    adapter.emitGesture("right");
    vi.advanceTimersByTime(900);
    expect(adapter.store.getState().sleep).toBe("awake");
    adapter.dispose();
  });

  it("a gesture wakes a sleeping display and is consumed", async () => {
    const { adapter, events, gestures } = setup();
    await start(adapter);
    adapter.sleepNow();
    adapter.emitGesture("right");
    expect(adapter.store.getState().sleep).toBe("awake");
    expect(events).toEqual(["slept", "woke"]);
    expect(gestures).toEqual([]);
    adapter.emitGesture("right");
    expect(gestures).toEqual(["right"]);
    adapter.dispose();
  });
});

describe("SIM-SES-05 disconnect and reconnect", () => {
  it("drops the session and input, then restores the session on reconnect", async () => {
    const { adapter, events, gestures } = setup();
    await start(adapter);
    adapter.disconnect();
    expect(adapter.session.state).toBe("stopped");
    adapter.emitGesture("right");
    expect(gestures).toEqual([]);
    await expect(adapter.session.start()).rejects.toMatchObject({ code: "session-inactive" });

    const back = adapter.reconnect();
    // Just past the simulated reconnect delay, not the idle timer.
    await vi.advanceTimersByTimeAsync(900);
    await back;
    expect(adapter.session.state).toBe("started");
    expect(events).toEqual(["disconnected", "reconnected"]);
    adapter.dispose();
  });
});
