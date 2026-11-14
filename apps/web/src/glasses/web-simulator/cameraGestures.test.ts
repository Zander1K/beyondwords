import { describe, expect, it } from "vitest";

import { createHandsFeed } from "@/vision/handTracking";
import { makeHand } from "@/vision/testHands";

import { CameraGestureRecognizer } from "./cameraGestures";
import { WebSimulatorAdapter } from "./WebSimulatorAdapter";

const PALM = { index: true, middle: true, ring: true, pinky: true };

/** Feed a sequence of single-hand frames 50 ms apart; collect gestures. */
function feed(r: CameraGestureRecognizer, frames: ReturnType<typeof makeHand>[], t0 = 0) {
  return frames.flatMap((hand, i) => r.update([hand], t0 + i * 50));
}

describe("CameraGestureRecognizer", () => {
  it("fires select once per thumb-index pinch, after it holds for two frames", () => {
    const r = new CameraGestureRecognizer();
    const pinch = makeHand({ index: true, pinch: "index" });
    const open = makeHand({ index: true });
    expect(feed(r, [pinch])).toEqual([]);
    expect(feed(r, [pinch, pinch, pinch], 50)).toEqual(["select"]);
    // Release, wait out the cooldown, pinch again.
    expect(feed(r, [open, open, pinch, pinch], 1000)).toEqual(["select"]);
  });

  it("maps a thumb-middle pinch to back", () => {
    const r = new CameraGestureRecognizer();
    const pinch = makeHand({ middle: true, pinch: "middle" });
    expect(feed(r, [pinch, pinch])).toEqual(["back"]);
  });

  it("recognises open-palm swipes in four directions", () => {
    const swipe = (dx: number, dy: number, mirrored = false) => {
      const r = new CameraGestureRecognizer({ mirrored: () => mirrored });
      const frames = [0, 1, 2, 3, 4].map((i) =>
        makeHand({ ...PALM, at: { x: 0.5 + (dx * i) / 4, y: 0.8 + (dy * i) / 4 } }),
      );
      return feed(r, frames);
    };
    expect(swipe(0.2, 0)).toEqual(["right"]);
    expect(swipe(-0.2, 0)).toEqual(["left"]);
    expect(swipe(0, 0.2)).toEqual(["down"]);
    expect(swipe(0, -0.2)).toEqual(["up"]);
    expect(swipe(0.2, 0, true)).toEqual(["left"]);
  });

  it("never treats a moving pointing finger as a gesture", () => {
    const r = new CameraGestureRecognizer();
    const frames = [0, 1, 2, 3, 4, 5].map((i) =>
      makeHand({ index: true, at: { x: 0.3 + i * 0.08, y: 0.8 } }),
    );
    expect(feed(r, frames)).toEqual([]);
  });

  it("ignores slow palm drift", () => {
    const r = new CameraGestureRecognizer();
    const frames = Array.from({ length: 30 }, (_, i) =>
      makeHand({ ...PALM, at: { x: 0.3 + i * 0.01, y: 0.8 } }),
    );
    expect(feed(r, frames)).toEqual([]);
  });
});

describe("WebSimulatorAdapter camera gestures", () => {
  it("delivers camera gestures through onGesture and logs them as camera input", () => {
    const adapter = new WebSimulatorAdapter({ keyTarget: new EventTarget() });
    const seen: string[] = [];
    adapter.onGesture((g) => seen.push(g));
    const hands = createHandsFeed();
    const detach = adapter.attachCameraGestures(hands);
    const pinch = {
      landmarks: makeHand({ index: true, pinch: "index" }),
      handedness: null,
      score: 1,
    };
    hands.publish({ hands: [pinch], at: 0, detectMs: 1 });
    hands.publish({ hands: [pinch], at: 50, detectMs: 1 });
    expect(seen).toEqual(["select"]);
    expect(adapter.store.getState().gestureLog[0]?.source).toBe("camera index pinch");

    adapter.setCameraGestures(false);
    hands.publish({ hands: [], at: 100, detectMs: 1 });
    hands.publish({ hands: [pinch], at: 1000, detectMs: 1 });
    hands.publish({ hands: [pinch], at: 1050, detectMs: 1 });
    expect(seen).toEqual(["select"]);
    detach();
    adapter.dispose();
  });
});
