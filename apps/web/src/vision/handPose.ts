// Hand pose from the 21 MediaPipe hand landmarks (normalised image coordinates). Plain logic so
// it can be tested without a camera.
//
// Landmarks: 0 wrist; thumb 1-4; index 5 (knuckle) 6 7 8 (tip); middle 9-12; ring 13-16;
// pinky 17-20.
// [ASSUMPTION] All thresholds are first guesses for a camera looking down at a book; tune them
// on real footage (SIM-VIS-06, P1).

export interface Point {
  x: number;
  y: number;
}

export type Hand = readonly Point[];

export const LM = {
  wrist: 0,
  thumbTip: 4,
  indexMcp: 5,
  indexPip: 6,
  indexTip: 8,
  middleMcp: 9,
  middlePip: 10,
  middleTip: 12,
  ringMcp: 13,
  ringPip: 14,
  ringTip: 16,
  pinkyMcp: 17,
  pinkyPip: 18,
  pinkyTip: 20,
} as const;

export const POSE_THRESHOLDS = {
  /** A finger is extended when its tip is this much farther from the wrist than its middle joint. */
  extendedRatio: 1.12,
  /** Thumb tip to fingertip, relative to hand size, to count as a pinch... */
  pinchOn: 0.3,
  /** ...and to count as released (hysteresis). */
  pinchOff: 0.45,
} as const;

const dist = (a: Point | undefined, b: Point | undefined) =>
  a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Number.POSITIVE_INFINITY;

/** Wrist to middle knuckle: a scale for the hand that does not depend on the pose. */
export function handSize(hand: Hand): number {
  return dist(hand[LM.wrist], hand[LM.middleMcp]);
}

function extended(hand: Hand, pip: number, tip: number): boolean {
  const wrist = hand[LM.wrist];
  return dist(wrist, hand[tip]) > dist(wrist, hand[pip]) * POSE_THRESHOLDS.extendedRatio;
}

export interface Fingers {
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

export function extendedFingers(hand: Hand): Fingers {
  return {
    index: extended(hand, LM.indexPip, LM.indexTip),
    middle: extended(hand, LM.middlePip, LM.middleTip),
    ring: extended(hand, LM.ringPip, LM.ringTip),
    pinky: extended(hand, LM.pinkyPip, LM.pinkyTip),
  };
}

/** Thumb tip to a fingertip, relative to hand size. */
export function pinchDistance(hand: Hand, fingerTip: number): number {
  const size = handSize(hand);
  return size > 0 ? dist(hand[LM.thumbTip], hand[fingerTip]) / size : Number.POSITIVE_INFINITY;
}

export type Pose = "pointing" | "pinch-index" | "pinch-middle" | "open-palm" | "other";

/**
 * Classify one frame. Pinches are checked first (a pinching hand may still look "pointed").
 * `pinched` carries hysteresis: an ongoing pinch stays a pinch until the fingers clearly part.
 */
export function classifyPose(hand: Hand, pinched: "index" | "middle" | null = null): Pose {
  const indexGap = pinchDistance(hand, LM.indexTip);
  const middleGap = pinchDistance(hand, LM.middleTip);
  const { pinchOn, pinchOff } = POSE_THRESHOLDS;
  if (pinched === "index" && indexGap < pinchOff) return "pinch-index";
  if (pinched === "middle" && middleGap < pinchOff) return "pinch-middle";
  if (indexGap < pinchOn && indexGap <= middleGap) return "pinch-index";
  if (middleGap < pinchOn && middleGap < indexGap) return "pinch-middle";

  const f = extendedFingers(hand);
  if (f.index && f.middle && f.ring && f.pinky) return "open-palm";
  if (f.index && !f.middle && !f.ring && !f.pinky) return "pointing";
  return "other";
}

/** Centre of the palm: average of the wrist and the four knuckles. */
export function palmCentre(hand: Hand): Point {
  const ids = [LM.wrist, LM.indexMcp, LM.middleMcp, LM.ringMcp, LM.pinkyMcp];
  const pts = ids.map((i) => hand[i]).filter((p): p is Point => Boolean(p));
  const n = pts.length || 1;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  };
}
