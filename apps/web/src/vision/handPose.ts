// Hand pose from the 21 MediaPipe hand landmarks (normalised image coordinates). Plain logic so
// it can be tested without a camera.
//
// Landmarks: 0 wrist; thumb 1-4; index 5 (knuckle) 6 7 8 (tip); middle 9-12; ring 13-16;
// pinky 17-20.
//
// Finger extension comes from MediaPipe's 3D world landmarks (metres, hand-centred) when they
// are there: the bend of each finger's joints does not depend on how the hand is turned to the
// camera. In 2D a finger pointing toward or away from the camera looks short and reads as
// curled, and loosely curled fingers (how people actually point at a page) can read as
// extended. Without world landmarks the 2D wrist-distance test is used.
// [ASSUMPTION] All thresholds are first guesses for a camera looking down at a book; tune them
// on real footage (SIM-VIS-06, P1).

export interface Point {
  x: number;
  y: number;
}

export type Hand = readonly Point[];

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** MediaPipe world landmarks: 21 points in metres, origin near the hand's centre. */
export type Hand3 = readonly Point3[];

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

/**
 * Joint-bend thresholds (degrees, 3D). A straight finger bends ~10-30 deg over its two middle
 * joints, a loosely curled one ~80-150, a fist ~180+.
 * [ASSUMPTION] First values from MediaPipe's typical ranges; tune on real footage.
 */
export const BEND_THRESHOLDS = {
  /** A finger bent less than this is extended (open palm, pinch shapes). */
  extended: 55,
  /** The pointing index may bend this much... */
  pointIndex: 60,
  /** ...and the other three must bend this much more than it on average. */
  pointContrast: 45,
  /** Once a hand is the pointer, it stays one with these looser values (hysteresis). */
  holdIndex: 85,
  holdContrast: 20,
} as const;

/**
 * The controls gesture, a "shaka": thumb and little finger out, the other three fingers curled.
 * It was a fist first, but a fist's thumb lies across the fingers and read as a thumb-finger
 * touch (the pinch gestures). Here the thumb is as far from the fingertips as it can be, the
 * index is curled (so it is not a point), and the little finger is out, which no other gesture
 * uses. Pinches are checked before it, so a pinch with the pinky lifted is never this.
 * [ASSUMPTION] Thresholds are first values from MediaPipe's typical ranges; tune on real footage.
 */
export const SHAKA_THRESHOLDS = {
  /** Index, middle and ring bent at least this much (a loose curl is 80-150, closed 170+). */
  curled: 100,
  /** The little finger bent no more than this (out; a straight finger is 10-30). */
  pinkyOut: 55,
  /** The thumb bent no more than this over its two joints (out; a straight thumb is 10-30). */
  thumbBend: 60,
  /** The thumb tip at least this far (x hand size) from the index knuckle (a tucked thumb is ~0.3). */
  thumbAway: 0.85,
} as const;

/**
 * The page gesture, the "rock sign": index and little finger out, middle and ring curled; the
 * thumb is free (it usually rests over the curled fingers). Held for a moment it asks for the
 * whole page's gist. It differs from the controls pose (SHAKA) by the index: out here, curled
 * there. Needs the 3D world landmarks; without them it is never true.
 * [ASSUMPTION] Thresholds are first values from MediaPipe's typical ranges; tune on real footage.
 */
export const HORNS_THRESHOLDS = {
  /** Index and little finger bent no more than this (out; a straight finger is 10-30). */
  out: 55,
  /** Middle and ring bent at least this much (curled; a loose curl is 80-150, closed 170+). */
  curled: 100,
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

type Joint = Point & { z?: number };

/** Angle between two segments a->b and b->c, degrees (0 = straight on). */
function turn(a: Joint | undefined, b: Joint | undefined, c: Joint | undefined): number {
  if (!a || !b || !c) return 0;
  const u = [b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0)];
  const v = [c.x - b.x, c.y - b.y, (c.z ?? 0) - (b.z ?? 0)];
  const nu = Math.hypot(...u);
  const nv = Math.hypot(...v);
  if (nu === 0 || nv === 0) return 0;
  const cos =
    ((u[0] ?? 0) * (v[0] ?? 0) + (u[1] ?? 0) * (v[1] ?? 0) + (u[2] ?? 0) * (v[2] ?? 0)) / (nu * nv);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

const FINGER_MCP = {
  index: LM.indexMcp,
  middle: LM.middleMcp,
  ring: LM.ringMcp,
  pinky: LM.pinkyMcp,
};
type FingerName = keyof typeof FINGER_MCP;

/** How much a finger bends over its middle joints (PIP + DIP), degrees. */
export function fingerBend(points: readonly Joint[], finger: FingerName): number {
  const m = FINGER_MCP[finger];
  return (
    turn(points[m], points[m + 1], points[m + 2]) +
    turn(points[m + 1], points[m + 2], points[m + 3])
  );
}

export interface Bends {
  index: number;
  middle: number;
  ring: number;
  pinky: number;
}

export function fingerBends(points: readonly Joint[]): Bends {
  return {
    index: fingerBend(points, "index"),
    middle: fingerBend(points, "middle"),
    ring: fingerBend(points, "ring"),
    pinky: fingerBend(points, "pinky"),
  };
}

export interface Fingers {
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

export function extendedFingers(hand: Hand, world?: Hand3): Fingers {
  if (world && world.length >= 21) {
    const b = fingerBends(world);
    const limit = BEND_THRESHOLDS.extended;
    return {
      index: b.index < limit,
      middle: b.middle < limit,
      ring: b.ring < limit,
      pinky: b.pinky < limit,
    };
  }
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

export type Pose =
  "pointing" | "pinch-index" | "pinch-middle" | "open-palm" | "shaka" | "horns" | "other";

/**
 * Is this hand pointing (the reading cursor)? Forgiving on purpose: the index is clearly
 * straighter than the other three, which may be loosely curled. `wasPointing` (this hand was the
 * pointer last frame) loosens the test so the cursor does not drop when a finger drifts.
 */
export function isPointing(hand: Hand, world?: Hand3, wasPointing = false): boolean {
  if (pinchDistance(hand, LM.indexTip) < POSE_THRESHOLDS.pinchOn) return false;
  if (world && world.length >= 21) {
    const b = fingerBends(world);
    const others = (b.middle + b.ring + b.pinky) / 3;
    const t = BEND_THRESHOLDS;
    return wasPointing
      ? b.index < t.holdIndex && others - b.index > t.holdContrast
      : b.index < t.pointIndex && others - b.index > t.pointContrast;
  }
  const f = extendedFingers(hand);
  const othersOut = Number(f.middle) + Number(f.ring) + Number(f.pinky);
  return f.index && othersOut <= (wasPointing ? 1 : 0);
}

const dist3 = (a: Point3 | undefined, b: Point3 | undefined) =>
  a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Number.POSITIVE_INFINITY;

/** How much the thumb bends over its two joints (CMC-MCP-IP and MCP-IP-tip), degrees, in 3D. */
export function thumbBend(world: Hand3): number {
  return turn(world[1], world[2], world[3]) + turn(world[2], world[3], world[4]);
}

/**
 * The controls gesture (see SHAKA_THRESHOLDS): thumb and little finger out, index, middle and
 * ring curled. Needs the 3D world landmarks; without them it is never true.
 */
export function isShaka(world?: Hand3): boolean {
  if (!world || world.length < 21) return false;
  const t = SHAKA_THRESHOLDS;
  const b = fingerBends(world);
  const size = dist3(world[LM.wrist], world[LM.middleMcp]);
  if (!(size > 0)) return false;
  const away = dist3(world[LM.thumbTip], world[LM.indexMcp]) / size;
  return (
    Math.min(b.index, b.middle, b.ring) >= t.curled &&
    b.pinky <= t.pinkyOut &&
    thumbBend(world) <= t.thumbBend &&
    away >= t.thumbAway
  );
}

/**
 * The page gesture (see HORNS_THRESHOLDS): index and little finger out, middle and ring curled.
 * Needs the 3D world landmarks; without them it is never true.
 */
export function isHorns(world?: Hand3): boolean {
  if (!world || world.length < 21) return false;
  const t = HORNS_THRESHOLDS;
  const b = fingerBends(world);
  return b.index <= t.out && b.pinky <= t.out && b.middle >= t.curled && b.ring >= t.curled;
}

/**
 * Classify one frame. Pinches are checked first (a pinching hand may still look "pointed").
 * `pinched` carries hysteresis: an ongoing pinch stays a pinch until the fingers clearly part.
 * `world` (3D landmarks) makes finger extension independent of how the hand faces the camera.
 * Order matters: a pinch wins over everything, so the other poses can never steal one.
 */
export function classifyPose(
  hand: Hand,
  pinched: "index" | "middle" | null = null,
  world?: Hand3,
  wasPointing = false,
): Pose {
  const indexGap = pinchDistance(hand, LM.indexTip);
  const middleGap = pinchDistance(hand, LM.middleTip);
  const { pinchOn, pinchOff } = POSE_THRESHOLDS;
  // Before the pinches: in a rock sign the thumb rests on the curled middle finger and reads as
  // a thumb-middle pinch ("back"). The index being straight and clear of the thumb is what
  // separates it from a real pinch of the index.
  if (isHorns(world) && indexGap >= pinchOn) return "horns";
  if (pinched === "index" && indexGap < pinchOff) return "pinch-index";
  if (pinched === "middle" && middleGap < pinchOff) return "pinch-middle";
  if (indexGap < pinchOn && indexGap <= middleGap) return "pinch-index";
  if (middleGap < pinchOn && middleGap < indexGap) return "pinch-middle";

  // After the pinches, so a pinch with the little finger lifted is still a pinch.
  if (isShaka(world)) return "shaka";

  const f = extendedFingers(hand, world);
  if (f.index && f.middle && f.ring && f.pinky) return "open-palm";
  if (isPointing(hand, world, wasPointing)) return "pointing";
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
