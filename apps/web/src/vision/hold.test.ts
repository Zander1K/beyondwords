import { describe, expect, it } from "vitest";

import { HoldDetector } from "./hold";

/** Frames 50 ms apart: `pattern` is a string of 1 (pose present) and 0 (absent). */
function run(d: HoldDetector, pattern: string, t0 = 0) {
  return [...pattern].map((c, i) => d.update(c === "1", t0 + i * 50));
}

describe("HoldDetector", () => {
  it("fires once after the hold time, with rising progress", () => {
    const d = new HoldDetector(500, 100);
    const out = run(d, "1".repeat(14));
    expect(out[0]?.progress).toBe(0);
    expect(out[5]?.progress).toBeCloseTo(0.5, 5);
    expect(out.filter((s) => s.fired)).toHaveLength(1);
    expect(out[10]?.fired).toBe(true);
    // Keeps holding: no second firing.
    expect(out[13]?.fired).toBe(false);
  });

  it("does not fire on a quick pose", () => {
    const d = new HoldDetector(500, 100);
    expect(run(d, "11111" + "0".repeat(10)).some((s) => s.fired)).toBe(false);
  });

  it("forgives a missed detection or two", () => {
    const d = new HoldDetector(500, 100);
    const out = run(d, "11111" + "0" + "11111111");
    expect(out.some((s) => s.fired)).toBe(true);
  });

  it("must be released before it can fire again", () => {
    const d = new HoldDetector(500, 100);
    const first = run(d, "1".repeat(12));
    expect(first.filter((s) => s.fired)).toHaveLength(1);
    const second = run(d, "0".repeat(5) + "1".repeat(12), 12 * 50);
    expect(second.filter((s) => s.fired)).toHaveLength(1);
  });
});
