import { describe, expect, it } from "vitest";

import { changedShare, CLOUD_POLICY, CloudGate } from "./cloudPolicy";

describe("changedShare", () => {
  it("is 0 for the same picture and 1 for a different one", () => {
    const a = Uint8Array.from({ length: 100 }, () => 100);
    expect(changedShare(a, a)).toBe(0);
    expect(
      changedShare(
        a,
        Uint8Array.from({ length: 100 }, () => 200),
      ),
    ).toBe(1);
  });

  it("ignores small brightness drift and counts big changes", () => {
    const a = Uint8Array.from({ length: 100 }, () => 100);
    const drift = Uint8Array.from({ length: 100 }, () => 110);
    expect(changedShare(a, drift)).toBe(0);
    const hand = Uint8Array.from({ length: 100 }, (_, i) => (i < 10 ? 20 : 100));
    expect(changedShare(a, hand)).toBeCloseTo(0.1); // a hand covers a few cells
  });
});

describe("CloudGate", () => {
  it("reads the first time", () => {
    expect(new CloudGate().decide(0, null)).toBe("read");
  });

  it("reuses the last reading while nothing changed, and reads when the scene changes", () => {
    const g = new CloudGate();
    g.record(0);
    expect(g.decide(5000, false)).toBe("reuse");
    expect(g.decide(5000, true)).toBe("read");
  });

  it("never reads more often than the minimum interval, even if the scene changed", () => {
    const g = new CloudGate();
    g.record(0);
    expect(g.decide(CLOUD_POLICY.minIntervalMs - 1, true)).toBe("reuse");
    expect(g.decide(CLOUD_POLICY.minIntervalMs, true)).toBe("read");
  });

  it("reads again after a long time even if nothing seems to have changed", () => {
    const g = new CloudGate();
    g.record(0);
    expect(g.decide(CLOUD_POLICY.maxAgeMs, false)).toBe("read");
  });

  it("stops at the per-minute ceiling to protect the quota", () => {
    const g = new CloudGate();
    let t = 0;
    for (let i = 0; i < CLOUD_POLICY.maxPerMinute; i++) {
      expect(g.decide(t, i === 0 ? null : true)).toBe("read");
      g.record(t);
      t += CLOUD_POLICY.minIntervalMs;
    }
    expect(g.decide(t, true)).toBe("reuse"); // the ceiling, though the scene changed
    expect(g.decide(60_001 + CLOUD_POLICY.minIntervalMs, true)).toBe("read"); // a minute later
  });
});
