// Finger-only detection: the fingertip when just a finger is in the frame (SIM-VIS-01, -04).
//
// MediaPipe's hand landmarker starts from a PALM detector, so a finger that pokes into the frame
// with the palm outside it is never found (tracking survives the palm leaving the frame only if
// the whole hand was seen first). Close to the page, which is how people point at small print,
// that is the usual case. This runs on frames where MediaPipe sees no hand:
//
//   1. Skin pixels on a small copy of the frame (YCrCb chroma). Webcam auto white balance keeps
//      the page near neutral; skin stays clearly red-shifted. Once MediaPipe has seen the whole
//      hand, the test is a colour model learned from the user's own skin under the current light.
//   2. Connected blobs that enter from an edge of the frame and are long and thin like a finger.
//   3. The tip: the blob's pixel farthest from where it enters the frame.
//
// It fails safe: if the paper ever reads as skin, the blob is far too big and is rejected (no
// finger, rather than a wrong one).
// [ASSUMPTION] Thresholds are first values from synthetic frames; tune on real footage.
// Pure functions, no browser APIs.
import type { Point } from "./handPose";

/** YCrCb (BT.601, full range) of an RGB pixel. */
export function toYCrCb(r: number, g: number, b: number): { y: number; cr: number; cb: number } {
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    cr: 128 + 0.5 * r - 0.4187 * g - 0.0813 * b,
    cb: 128 - 0.1687 * r - 0.3313 * g + 0.5 * b,
  };
}

/**
 * Default skin test, before a model is learned. [ASSUMPTION] Set on rendered light to very dark
 * skin tones against white and cream paper; check on real footage.
 */
export const DEFAULT_SKIN = {
  /** Darker than this, chroma is mostly noise. Low enough for the shaded edge of dark skin. */
  minY: 22,
  minCr: 133,
  maxCr: 180,
  minCb: 77,
  maxCb: 127,
  /** Skin is red-shifted: Cr clearly above Cb. Neutral (white-balanced) paper is not. */
  minCrMinusCb: 15,
  /**
   * Hue: skin is redder than cream paper. In (Cr, Cb) skin has Cr - 128 >= ~1.1 x (128 - Cb)
   * (hue ~19-25 deg); cream and aged paper ~0.7 (hue ~35-40 deg). Wood is skin-coloured.
   */
  minRedness: 0.9,
} as const;

/** Learned model: squared Mahalanobis distance in (Cr, Cb) below this is skin (~3 sigma). */
const LEARNED_MAX_D2 = 9;
/** Fewest samples before a learned model replaces the default test. */
const MIN_SAMPLES = 60;
/** Samples kept (newest win), so the model follows changing light. */
const MAX_SAMPLES = 600;

/** Samples farther than this (squared Mahalanobis) from the first fit are dropped. */
const TRIM_D2 = 6;

/** Mean and inverse covariance in (Cr, Cb). */
interface Gaussian {
  mcr: number;
  mcb: number;
  icc: number;
  ibb: number;
  icb: number;
}

function gaussian(s: readonly { cr: number; cb: number }[]): Gaussian | null {
  if (s.length < MIN_SAMPLES) return null;
  const mean = (f: (p: { cr: number; cb: number }) => number) =>
    s.reduce((a, p) => a + f(p), 0) / s.length;
  const mcr = mean((p) => p.cr);
  const mcb = mean((p) => p.cb);
  // Covariance, with a floor so a very uniform sample does not give a needle-thin model.
  const floor = 9; // (3 units)^2
  const vcc = Math.max(
    floor,
    mean((p) => (p.cr - mcr) ** 2),
  );
  const vbb = Math.max(
    floor,
    mean((p) => (p.cb - mcb) ** 2),
  );
  const vcb = mean((p) => (p.cr - mcr) * (p.cb - mcb));
  const det = vcc * vbb - vcb * vcb;
  if (det <= 0) return null;
  return { mcr, mcb, icc: vbb / det, ibb: vcc / det, icb: -vcb / det };
}

function distance2(g: Gaussian, cr: number, cb: number): number {
  const dc = cr - g.mcr;
  const db = cb - g.mcb;
  return dc * dc * g.icc + 2 * dc * db * g.icb + db * db * g.ibb;
}

/** Skin colour: the default test, or a Gaussian in (Cr, Cb) learned from the user's hand. */
export class SkinModel {
  private samples: { cr: number; cb: number }[] = [];
  private model: Gaussian | null = null;

  get learned(): boolean {
    return this.model !== null;
  }

  /** Add skin pixel colours (RGB), e.g. sampled under MediaPipe's finger landmarks. */
  learn(pixels: readonly { r: number; g: number; b: number }[]): void {
    for (const p of pixels) {
      const c = toYCrCb(p.r, p.g, p.b);
      // Too dark or not skin-like at all (a landmark off the hand): skip.
      if (c.y < DEFAULT_SKIN.minY || c.cr - c.cb < 5) continue;
      this.samples.push({ cr: c.cr, cb: c.cb });
    }
    if (this.samples.length > MAX_SAMPLES)
      this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    this.fit();
  }

  /**
   * Gaussian fit, twice: the second time without samples far from the first fit, so the odd
   * sample that landed on the page next to a finger does not widen the model toward paper.
   */
  private fit(): void {
    const first = gaussian(this.samples);
    if (!first) return;
    const inliers = this.samples.filter((p) => distance2(first, p.cr, p.cb) < TRIM_D2);
    this.model = (inliers.length >= MIN_SAMPLES ? gaussian(inliers) : null) ?? first;
  }

  isSkin(r: number, g: number, b: number): boolean {
    const c = toYCrCb(r, g, b);
    if (c.y < DEFAULT_SKIN.minY) return false;
    const m = this.model;
    if (m) {
      return distance2(m, c.cr, c.cb) < LEARNED_MAX_D2;
    }
    const d = DEFAULT_SKIN;
    return (
      c.cr >= d.minCr &&
      c.cr <= d.maxCr &&
      c.cb >= d.minCb &&
      c.cb <= d.maxCb &&
      c.cr - c.cb >= d.minCrMinusCb &&
      c.cr - 128 >= d.minRedness * (128 - c.cb)
    );
  }

  reset(): void {
    this.samples = [];
    this.model = null;
  }
}

export const FINGER_TUNING = {
  /** Smallest blob, as a fraction of the frame's area. */
  minArea: 0.0015,
  /** Largest blob (a finger plus a bit of hand), as a fraction of the frame's area. */
  maxArea: 0.12,
  /** Length from the frame edge to the tip, at least this many times the mean width. */
  minElongation: 2.2,
  /** Mean width, as a fraction of the frame's shorter side. */
  minWidth: 0.012,
  maxWidth: 0.2,
  /**
   * A finger stands out from what is around it; shaded paper does not. The blob's colour must
   * differ from a ring of pixels just outside it by at least this much (a distance in YCrCb,
   * brightness counting half). On photos of the demo book, warm-lit paper is skin-coloured
   * (15-35% of the frame passed the colour test) while the real thumb is much darker than the
   * page around it (about 50 levels of brightness; distance ~26).
   */
  minContrast: 14,
  /** How far outside the blob the surrounding ring is sampled (pixels at the 320 px scale). */
  ringOffset: 6,
} as const;

export interface FingerTip {
  /** Normalised 0-1. */
  tip: Point;
  /** Where the finger enters the frame (normalised): the tip points away from it. */
  base: Point;
  /** 0-1: how finger-like the blob is. */
  score: number;
  /** How much the blob's colour differs from its surroundings (0 when the image was not given). */
  contrast: number;
}

/** Skin mask, cleaned with a 3x3 opening (drops specks and one-pixel bridges). */
export function skinMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  skin: SkinModel,
): Uint8Array {
  const raw = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < raw.length; p++, i += 4) {
    if (skin.isSkin(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0)) raw[p] = 1;
  }
  const pass = (src: Uint8Array, keep: (n: number) => boolean) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(width - 1, Math.max(0, x + dx));
            const yy = Math.min(height - 1, Math.max(0, y + dy));
            n += src[yy * width + xx] ?? 0;
          }
        }
        if (keep(n)) out[y * width + x] = 1;
      }
    }
    return out;
  };
  const eroded = pass(raw, (n) => n === 9);
  return pass(eroded, (n) => n > 0);
}

/**
 * How much a blob's colour differs from the pixels just outside it: the distance in YCrCb between
 * the blob's mean colour and the mean of a ring around it, brightness counting half. 0 when the
 * blob has no surroundings to compare with.
 */
export function ringContrast(
  rgba: Uint8ClampedArray,
  label: Int32Array,
  id: number,
  pixels: readonly number[],
  width: number,
  height: number,
): number {
  const colour = (p: number) =>
    toYCrCb(rgba[p * 4] ?? 0, rgba[p * 4 + 1] ?? 0, rgba[p * 4 + 2] ?? 0);
  const inside = [0, 0, 0];
  const around = [0, 0, 0];
  let nIn = 0;
  let nOut = 0;
  const stride = Math.max(1, Math.floor(pixels.length / 400));
  const r = FINGER_TUNING.ringOffset;
  for (let k = 0; k < pixels.length; k += stride) {
    const p = pixels[k] ?? 0;
    const x = p % width;
    const y = (p - x) / width;
    const c = colour(p);
    inside[0] = (inside[0] ?? 0) + c.y;
    inside[1] = (inside[1] ?? 0) + c.cr;
    inside[2] = (inside[2] ?? 0) + c.cb;
    nIn++;
    for (const [dx, dy] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ] as const) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const q = yy * width + xx;
      if (label[q] === id) continue;
      const o = colour(q);
      around[0] = (around[0] ?? 0) + o.y;
      around[1] = (around[1] ?? 0) + o.cr;
      around[2] = (around[2] ?? 0) + o.cb;
      nOut++;
    }
  }
  if (!nIn || !nOut) return 0;
  const d = (i: number) => (inside[i] ?? 0) / nIn - (around[i] ?? 0) / nOut;
  return Math.hypot(d(0) * 0.5, d(1), d(2));
}

/**
 * The most finger-like blob in `mask` that enters from an edge of the frame, and its tip; null
 * when there is none. With `rgba` (the image the mask came from) a blob that does not stand out
 * from its surroundings is rejected: shaded paper is skin-coloured, a finger is not paper.
 */
export function findFingertip(
  mask: Uint8Array,
  width: number,
  height: number,
  rgba?: Uint8ClampedArray,
): FingerTip | null {
  const area = width * height;
  const label = new Int32Array(area);
  const stack: number[] = [];
  let best: FingerTip | null = null;
  let bestLength = 0;
  let next = 0;
  const short = Math.min(width, height);

  for (let start = 0; start < area; start++) {
    if (!mask[start] || label[start]) continue;
    next += 1;
    // Flood fill one blob (4-connected), collecting its pixels and its edge contacts.
    const pixels: number[] = [];
    let edgeX = 0;
    let edgeY = 0;
    let edgeN = 0;
    label[start] = next;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop() ?? 0;
      pixels.push(p);
      const x = p % width;
      const y = (p - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        edgeX += x;
        edgeY += y;
        edgeN += 1;
      }
      const visit = (q: number) => {
        if (mask[q] && !label[q]) {
          label[q] = next;
          stack.push(q);
        }
      };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (y > 0) visit(p - width);
      if (y < height - 1) visit(p + width);
    }

    const n = pixels.length;
    if (edgeN === 0) continue; // a finger comes in from outside the frame
    if (n < FINGER_TUNING.minArea * area || n > FINGER_TUNING.maxArea * area) continue;

    const bx = edgeX / edgeN;
    const by = edgeY / edgeN;
    let tipP = pixels[0] ?? 0;
    let far = -1;
    for (const p of pixels) {
      const x = p % width;
      const y = (p - x) / width;
      const d = (x - bx) ** 2 + (y - by) ** 2;
      if (d > far) {
        far = d;
        tipP = p;
      }
    }
    const length = Math.sqrt(far);
    if (length <= 0) continue;
    const meanWidth = n / length;
    const elongation = length / meanWidth;
    if (elongation < FINGER_TUNING.minElongation) continue;
    if (meanWidth < FINGER_TUNING.minWidth * short || meanWidth > FINGER_TUNING.maxWidth * short) {
      continue;
    }

    let contrast = 0;
    if (rgba) {
      contrast = ringContrast(rgba, label, next, pixels, width, height);
      if (contrast < FINGER_TUNING.minContrast) continue;
    }

    const score = Math.min(1, elongation / (FINGER_TUNING.minElongation * 2));
    const tx = tipP % width;
    const ty = (tipP - tx) / width;
    // Ties: the longer finger (it reaches farther into the frame).
    if (!best || score > best.score || (score === best.score && length > bestLength)) {
      bestLength = length;
      best = {
        tip: { x: (tx + 0.5) / width, y: (ty + 0.5) / height },
        base: { x: (bx + 0.5) / width, y: (by + 0.5) / height },
        score,
        contrast,
      };
    }
  }
  return best;
}

/**
 * Where to sample the user's skin on a hand MediaPipe has found: along the index and middle
 * fingers' first two bones and across the palm (normalised), well inside the hand's outline.
 */
export function skinSamplePoints(hand: readonly Point[]): Point[] {
  const bones: [number, number][] = [
    [5, 6],
    [6, 7],
    [9, 10],
    [10, 11],
    [13, 14],
    [0, 9],
    [0, 5],
    [0, 13],
  ];
  const out: Point[] = [];
  for (const [a, b] of bones) {
    const p = hand[a];
    const q = hand[b];
    if (!p || !q) continue;
    for (const t of [0.3, 0.5, 0.7]) {
      const s = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      if (s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1) out.push(s);
    }
  }
  return out;
}
