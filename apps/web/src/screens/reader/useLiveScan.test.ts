import { describe, expect, it } from "vitest";

import { handsBox } from "./useLiveScan";

describe("handsBox", () => {
  it("covers all hand landmarks plus a margin, clamped to the frame", () => {
    const box = handsBox([
      {
        landmarks: [
          { x: 0.5, y: 0.6 },
          { x: 0.6, y: 0.9 },
        ],
        role: "pointer",
      },
      { landmarks: [{ x: 0.01, y: 0.5 }], role: "gesture" },
    ]);
    expect(box?.x).toBe(0);
    expect(box?.y).toBeCloseTo(0.46);
    expect((box?.x ?? 0) + (box?.w ?? 0)).toBeCloseTo(0.64);
    expect((box?.y ?? 0) + (box?.h ?? 0)).toBeCloseTo(0.94);
    expect(handsBox([])).toBeNull();
  });
});
