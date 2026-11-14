import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import { WebSimulatorAdapter } from "../web-simulator/WebSimulatorAdapter";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function started() {
  const adapter = new WebSimulatorAdapter({
    keyTarget: new EventTarget(),
    startDelayMs: 0,
    warn: () => {},
  });
  const start = adapter.session.start();
  await vi.runOnlyPendingTimersAsync();
  await start;
  return adapter;
}

describe("SIM-DSP-02 / 04 whole-screen updates, throttled", () => {
  it("throttles a 50 updates/s stress test to the 5/s limit and shows the latest", async () => {
    const adapter = await started();
    const before = adapter.store.getState().updateCount;
    for (let i = 1; i <= 50; i++) {
      adapter.showPhrase(`update ${i}`);
      vi.advanceTimersByTime(20);
    }
    vi.advanceTimersByTime(400);
    const updates = adapter.store.getState().updateCount - before;
    // 1 s of input + trailing flush at 5/s: about 5-7 whole-screen updates, never 50.
    expect(updates).toBeGreaterThanOrEqual(5);
    expect(updates).toBeLessThanOrEqual(7);
    const scene = adapter.store.getState().scene;
    expect(JSON.stringify(scene)).toContain('"update"');
    expect(JSON.stringify(scene)).toContain('"50"');
    adapter.dispose();
  });

  it("counts every flush as a whole-screen update with a timestamp", async () => {
    const adapter = await started();
    adapter.showPhrase("one");
    const s = adapter.store.getState();
    expect(s.updateCount).toBe(1);
    expect(s.lastUpdateAt).not.toBeNull();
    expect(s.scene?.type).toBe("flex");
    adapter.dispose();
  });

  it("follows the configured rate", async () => {
    const adapter = await started();
    adapter.setMaxUpdatesPerSecond(20);
    for (let i = 0; i < 20; i++) {
      adapter.showPhrase(`u${i}`);
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(100);
    expect(adapter.store.getState().updateCount).toBeGreaterThanOrEqual(18);
    adapter.dispose();
  });
});
