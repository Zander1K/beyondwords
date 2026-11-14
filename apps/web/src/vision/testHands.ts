// Synthetic hands for tests: a hand seen from above, wrist at the bottom, fingers pointing up.
import type { Point } from "./handPose";

export interface HandSpec {
  index?: boolean;
  middle?: boolean;
  ring?: boolean;
  pinky?: boolean;
  /** Put the thumb tip on this fingertip. */
  pinch?: "index" | "middle";
  /** Move the whole hand. */
  at?: Point;
}

export function makeHand(spec: HandSpec = {}): Point[] {
  const ox = (spec.at?.x ?? 0.5) - 0.5;
  const oy = (spec.at?.y ?? 0.8) - 0.8;
  const p = (x: number, y: number): Point => ({ x: x + ox, y: y + oy });
  const finger = (x: number, ext: boolean | undefined): Point[] => [
    p(x, 0.65), // knuckle
    p(x, 0.6), // middle joint
    ext ? p(x, 0.55) : p(x, 0.64),
    ext ? p(x, 0.5) : p(x, 0.67), // tip: far from the wrist when extended, tucked otherwise
  ];
  const hand: Point[] = [
    p(0.5, 0.8), // wrist
    p(0.44, 0.76),
    p(0.4, 0.72),
    p(0.37, 0.69),
    p(0.34, 0.66), // thumb tip
    ...finger(0.46, spec.index),
    ...finger(0.5, spec.middle),
    ...finger(0.54, spec.ring),
    ...finger(0.58, spec.pinky),
  ];
  if (spec.pinch) {
    const tip = hand[spec.pinch === "index" ? 8 : 12];
    if (tip) hand[4] = { x: tip.x + 0.01, y: tip.y + 0.01 };
  }
  return hand;
}
