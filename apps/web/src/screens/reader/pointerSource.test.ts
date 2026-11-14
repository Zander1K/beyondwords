import { describe, expect, it } from "vitest";

import { MOUSE_IDLE_MS, mouseIsPointer, toImagePoint } from "./pointerSource";

describe("mouseIsPointer", () => {
  it("is always the mouse or always the finger when chosen", () => {
    expect(mouseIsPointer("mouse", -Infinity, 5000)).toBe(true);
    expect(mouseIsPointer("finger", 4999, 5000)).toBe(false);
  });
  it("in auto follows the mouse while it moves, then hands back to the finger", () => {
    expect(mouseIsPointer("auto", 1000, 1000 + MOUSE_IDLE_MS - 1)).toBe(true);
    expect(mouseIsPointer("auto", 1000, 1000 + MOUSE_IDLE_MS)).toBe(false);
    expect(mouseIsPointer("auto", -Infinity, 0)).toBe(false);
  });
});

describe("toImagePoint", () => {
  const box = { left: 100, top: 50, width: 400, height: 200 };
  it("maps into 0-1 image coordinates", () => {
    expect(toImagePoint(300, 150, box)).toEqual({ x: 0.5, y: 0.5 });
    expect(toImagePoint(100, 50, box)).toEqual({ x: 0, y: 0 });
  });
  it("is null outside the image or for an empty box", () => {
    expect(toImagePoint(99, 100, box)).toBeNull();
    expect(toImagePoint(300, 251, box)).toBeNull();
    expect(toImagePoint(1, 1, { ...box, width: 0 })).toBeNull();
  });
});
