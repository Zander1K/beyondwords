import { describe, expect, it } from "vitest";

import { classifyPose } from "./handPose";
import { makeHand } from "./testHands";

describe("classifyPose", () => {
  it("recognises pointing, open palm and the two pinches", () => {
    expect(classifyPose(makeHand({ index: true }))).toBe("pointing");
    expect(classifyPose(makeHand({ index: true, middle: true, ring: true, pinky: true }))).toBe(
      "open-palm",
    );
    expect(classifyPose(makeHand({ index: true, pinch: "index" }))).toBe("pinch-index");
    expect(classifyPose(makeHand({ middle: true, pinch: "middle" }))).toBe("pinch-middle");
    expect(classifyPose(makeHand({}))).toBe("other");
  });
});
