import { describe, expect, it } from "vitest";

import { OneEuroFilter } from "./oneEuro";

describe("OneEuroFilter", () => {
  it("smooths jitter on a still fingertip", () => {
    const f = new OneEuroFilter();
    let maxDev = 0;
    for (let i = 0; i < 60; i++) {
      const noisy = 0.5 + (i % 2 ? 0.004 : -0.004);
      const out = f.filter(noisy, i * 50);
      if (i > 10) maxDev = Math.max(maxDev, Math.abs(out - 0.5));
    }
    expect(maxDev).toBeLessThan(0.0025); // input jitter is +-0.004
  });

  it("follows a fast move without much lag", () => {
    const f = new OneEuroFilter();
    let out = 0;
    // 0.6 units/s for half a second at 20 Hz.
    for (let i = 0; i <= 10; i++) out = f.filter(0.2 + 0.03 * i, i * 50);
    expect(0.5 - out).toBeLessThan(0.05);
  });

  it("starts over after a reset", () => {
    const f = new OneEuroFilter();
    f.filter(0.1, 0);
    f.reset();
    expect(f.filter(0.9, 50)).toBe(0.9);
  });
});
