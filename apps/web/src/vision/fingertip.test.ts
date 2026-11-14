import { describe, expect, it } from "vitest";

import {
  FINGER_TUNING,
  findFingertip,
  ringContrast,
  SkinModel,
  skinMask,
  skinSamplePoints,
} from "./fingertip";

const W = 320;
const H = 180;
type RGB = [number, number, number];
const PAPER: RGB = [236, 232, 224];
const CREAM: RGB = [240, 222, 196];
const SKIN: Record<string, RGB> = {
  light: [232, 190, 165],
  medium: [198, 145, 110],
  dark: [110, 72, 50],
};

/** A page with lines of "text", optionally a shape painted on it. */
function frame(paper: RGB, paint?: (x: number, y: number) => RGB | null): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ink = y % 12 < 4 && x % 7 < 5 && x > 30 && x < 290;
      let c: RGB = ink ? [45, 42, 40] : paper;
      c = paint?.(x, y) ?? c;
      const i = (y * W + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return data;
}

/** A finger 12 px wide coming up from the bottom edge to a rounded tip at (tx, ty). */
const finger =
  (skin: RGB, tx = 160, ty = 80) =>
  (x: number, y: number): RGB | null => {
    const r = 6;
    const inside = y >= ty + r ? Math.abs(x - tx) <= r : Math.hypot(x - tx, y - (ty + r)) <= r;
    return inside ? skin : null;
  };

// The image is passed too, so the check that a finger stands out from its surroundings runs.
const detect = (data: Uint8ClampedArray, skin = new SkinModel()) =>
  findFingertip(skinMask(data, W, H, skin), W, H, data);

describe("findFingertip", () => {
  it.each(Object.entries(SKIN))("finds the tip of a lone %s finger", (_, skin) => {
    const found = detect(frame(PAPER, finger(skin)));
    expect(found).not.toBeNull();
    expect(Math.abs((found?.tip.x ?? 0) * W - 160)).toBeLessThanOrEqual(3);
    expect(Math.abs((found?.tip.y ?? 0) * H - 80)).toBeLessThanOrEqual(3);
    // It enters from the bottom edge.
    expect(found?.base.y ?? 0).toBeGreaterThan(0.95);
  });

  it("finds a finger on cream paper (skin is redder than the page)", () => {
    expect(detect(frame(CREAM, finger(SKIN.medium as RGB)))).not.toBeNull();
  });

  it("finds nothing on a page without a finger", () => {
    expect(detect(frame(PAPER))).toBeNull();
    expect(detect(frame(CREAM))).toBeNull();
  });

  it("ignores skin-coloured shapes that do not come in from the edge, or are not finger-like", () => {
    const blob = (x: number, y: number): RGB | null =>
      Math.hypot(x - 160, y - 90) < 20 ? (SKIN.medium as RGB) : null;
    expect(detect(frame(PAPER, blob))).toBeNull();
    // A wide shape from the bottom edge (a palm, a sleeve): too wide for its length.
    const wide = (x: number, y: number): RGB | null =>
      y > 140 && Math.abs(x - 160) < 60 ? (SKIN.medium as RGB) : null;
    expect(detect(frame(PAPER, wide))).toBeNull();
  });
});

describe("SkinModel", () => {
  it("learns the user's skin and still rejects the page", () => {
    const model = new SkinModel();
    const skin = SKIN.dark as RGB;
    const samples = Array.from({ length: 80 }, (_, i) => ({
      r: skin[0] + (i % 5) - 2,
      g: skin[1] + (i % 3) - 1,
      b: skin[2] + (i % 4) - 2,
    }));
    // A few samples that landed on the page next to the finger.
    samples.push(...Array.from({ length: 6 }, () => ({ r: CREAM[0], g: CREAM[1], b: CREAM[2] })));
    model.learn(samples);
    expect(model.learned).toBe(true);
    expect(model.isSkin(...skin)).toBe(true);
    expect(model.isSkin(...CREAM)).toBe(false);
    expect(model.isSkin(...PAPER)).toBe(false);
  });

  it("samples the hand inside its outline, skipping points off the frame", () => {
    const hand = Array.from({ length: 21 }, (_, i) => ({ x: 0.5, y: 0.5 + i * 0.01 }));
    expect(skinSamplePoints(hand).length).toBeGreaterThan(10);
    const offFrame = hand.map((p) => ({ x: p.x, y: p.y + 1 }));
    expect(skinSamplePoints(offFrame)).toEqual([]);
  });
});

describe("a finger stands out from its surroundings", () => {
  /** A 40 x 40 image of one colour with a 10 x 20 blob of another in the middle, labelled 1. */
  function blobOn(ground: RGB, blob: RGB) {
    const w = 40;
    const h = 40;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const label = new Int32Array(w * h);
    const pixels: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inside = x >= 15 && x < 25 && y >= 10 && y < 30;
        const c = inside ? blob : ground;
        const p = y * w + x;
        rgba.set([c[0], c[1], c[2], 255], p * 4);
        if (inside) {
          label[p] = 1;
          pixels.push(p);
        }
      }
    }
    return ringContrast(rgba, label, 1, pixels, w, h);
  }

  it("is near zero when the blob is the colour of what is around it (shaded paper)", () => {
    expect(blobOn([153, 132, 117], [150, 130, 115])).toBeLessThan(FINGER_TUNING.minContrast / 2);
  });

  it("is large for a dark thumb on warm paper, though their chroma is alike", () => {
    // Measured on the demo book's photos: page [153,132,117], thumb [103,77,63].
    expect(blobOn([153, 132, 117], [103, 77, 63])).toBeGreaterThan(FINGER_TUNING.minContrast * 1.5);
  });

  it("is large for a light finger on white paper", () => {
    expect(blobOn(PAPER, SKIN.light as RGB)).toBeGreaterThan(FINGER_TUNING.minContrast);
  });

  it("rejects a finger-shaped blob that blends into the page around it", () => {
    // Warm paper everywhere that passes the skin colour test, and a barely different strip from
    // the bottom edge: nothing there stands out, whatever its shape.
    const warm: RGB = [190, 150, 120];
    const data = frame(warm, finger([186, 148, 118]));
    const skin = new SkinModel();
    // Narrow the model to the strip's own colour so only the strip is "skin", as a learned model
    // would be; it still looks just like the page, so there is no finger.
    skin.learn(Array.from({ length: 80 }, () => ({ r: 186, g: 148, b: 118 })));
    expect(detect(data, skin)).toBeNull();
    // The same shape in a colour that does stand out is found.
    expect(detect(frame(PAPER, finger(SKIN.medium as RGB)))).not.toBeNull();
  });
});
