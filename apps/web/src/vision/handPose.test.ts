import { describe, expect, it } from "vitest";

import { classifyPose, fingerBends, isPointing, isShaka, thumbBend } from "./handPose";
import { makeHand, makeHand3 } from "./testHands";

describe("classifyPose", () => {
  it("recognises pointing, open palm and the two pinches", () => {
    expect(classifyPose(makeHand({ index: true }))).toBe("pointing");
    expect(classifyPose(makeHand({ index: true, middle: true, ring: true, pinky: true }))).toBe(
      "open-palm",
    );
    expect(classifyPose(makeHand({ index: true, pinch: "index" }))).toBe("pinch-index");
    expect(classifyPose(makeHand({ middle: true, pinch: "middle" }))).toBe("pinch-middle");
    // Without 3D landmarks nothing is taken for the controls gesture.
    expect(classifyPose(makeHand({}))).toBe("other");
  });
});

describe("pose from 3D world landmarks", () => {
  // The 2D hand only supplies the pinch distances (thumb away from the fingertips).
  const flat = makeHand({ index: true });

  it("measures finger bends in degrees", () => {
    const b = fingerBends(makeHand3({ index: 10, middle: 120 }));
    expect(b.index).toBeCloseTo(10, 0);
    expect(b.middle).toBeCloseTo(120, 0);
  });

  it("counts a point with loosely curled other fingers as pointing", () => {
    // 2D alone would miss this: loosely curled fingers can look extended.
    const world = makeHand3({ index: 15, middle: 90, ring: 100, pinky: 85 });
    expect(classifyPose(flat, null, world)).toBe("pointing");
  });

  it("tells an open palm and a closed hand from a point", () => {
    expect(
      classifyPose(flat, null, makeHand3({ index: 10, middle: 12, ring: 15, pinky: 20 })),
    ).toBe("open-palm");
    expect(isPointing(flat, makeHand3({ index: 170, middle: 180, ring: 180, pinky: 175 }))).toBe(
      false,
    );
  });

  it("keeps a hand that was pointing as the pointer while its fingers drift (hysteresis)", () => {
    // Index bent a little more, the others opening up: not a fresh point, but still the pointer.
    const drifting = makeHand3({ index: 70, middle: 95, ring: 95, pinky: 90 });
    expect(isPointing(flat, drifting)).toBe(false);
    expect(isPointing(flat, drifting, true)).toBe(true);
  });

  it("never counts a pinch as pointing", () => {
    const world = makeHand3({ index: 15, middle: 120, ring: 120, pinky: 120 });
    expect(isPointing(makeHand({ index: true, pinch: "index" }), world)).toBe(false);
  });
});

describe("shaka: thumb and little finger out (hold to show or hide the controls)", () => {
  const flat = makeHand({ index: true });
  /** Index, middle, ring curled; little finger and thumb out. */
  const SHAKA = { index: 170, middle: 175, ring: 175, pinky: 10, thumb: "out" } as const;

  it("is thumb and little finger out with the other three curled", () => {
    expect(isShaka(makeHand3(SHAKA))).toBe(true);
    expect(classifyPose(flat, null, makeHand3(SHAKA))).toBe("shaka");
    // Looser curls still count (a real hand is not a robot).
    expect(isShaka(makeHand3({ ...SHAKA, index: 110, middle: 120, ring: 115, pinky: 40 }))).toBe(
      true,
    );
  });

  it("measures the thumb: out is nearly straight, tucked is folded", () => {
    expect(thumbBend(makeHand3({ thumb: "out" }))).toBeLessThan(15);
    expect(thumbBend(makeHand3({ thumb: "tucked" }))).toBeGreaterThan(60);
  });

  it("is not a fist (thumb folded in, little finger curled)", () => {
    const fist = makeHand3({ index: 170, middle: 175, ring: 175, pinky: 170, thumb: "tucked" });
    expect(isShaka(fist)).toBe(false);
    expect(classifyPose(flat, null, fist)).not.toBe("shaka");
  });

  it("is not a thumbs-up (little finger curled too)", () => {
    expect(isShaka(makeHand3({ ...SHAKA, pinky: 170 }))).toBe(false);
  });

  it("needs the thumb out: little finger out alone is not it", () => {
    expect(isShaka(makeHand3({ ...SHAKA, thumb: "tucked" }))).toBe(false);
  });

  it("is not a point, an open palm or a resting hand", () => {
    // Pointing: index straight, the others curled, thumb out of the way.
    const point = makeHand3({ index: 15, middle: 170, ring: 175, pinky: 170, thumb: "out" });
    expect(isShaka(point)).toBe(false);
    expect(classifyPose(flat, null, point)).toBe("pointing");
    // Open palm: every finger out.
    const palm = makeHand3({ index: 10, middle: 12, ring: 15, pinky: 20, thumb: "out" });
    expect(isShaka(palm)).toBe(false);
    expect(classifyPose(flat, null, palm)).toBe("open-palm");
    // A loosely curled resting hand, pinky and all.
    expect(isShaka(makeHand3({ index: 90, middle: 100, ring: 100, pinky: 90, thumb: "out" }))).toBe(
      false,
    );
    // A middle finger lifted with the pinky: two out is not it.
    expect(isShaka(makeHand3({ ...SHAKA, middle: 20 }))).toBe(false);
  });

  it("never steals a pinch, even with the little finger lifted and the thumb out", () => {
    // The 2D hand has the thumb on the index fingertip (a pinch); the 3D pose looks like a shaka.
    const pinching = makeHand({ index: true, pinch: "index" });
    expect(classifyPose(pinching, null, makeHand3(SHAKA))).toBe("pinch-index");
    expect(classifyPose(pinching, "index", makeHand3(SHAKA))).toBe("pinch-index");
    const middlePinch = makeHand({ middle: true, pinch: "middle" });
    expect(classifyPose(middlePinch, null, makeHand3(SHAKA))).toBe("pinch-middle");
  });

  it("is never true without 3D landmarks", () => {
    expect(isShaka(undefined)).toBe(false);
    expect(isShaka(makeHand3(SHAKA).slice(0, 10))).toBe(false);
  });
});
