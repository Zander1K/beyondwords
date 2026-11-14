// Synthetic hands for tests: a hand seen from above, wrist at the bottom, fingers pointing up.
import type { Point, Point3 } from "./handPose";

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

/** Total bend per finger over its two middle joints, degrees (0 = straight). */
export interface BendSpec {
  index?: number;
  middle?: number;
  ring?: number;
  pinky?: number;
  /**
   * The thumb: "out" sticks out to the side, "tucked" folds across the palm. Left out, it is
   * the neutral thumb the pinch and point tests were written with.
   */
  thumb?: "out" | "tucked";
}

/**
 * Synthetic 3D world landmarks (metres): fingers leave their knuckles along -y and curl toward
 * +z (into the palm), half the bend at each of the two middle joints.
 */
export function makeHand3(spec: BendSpec = {}): Point3[] {
  const finger = (x: number, bend = 0): Point3[] => {
    const half = ((bend / 2) * Math.PI) / 180;
    const knuckle = { x, y: -0.02, z: 0 };
    const pip = { x, y: knuckle.y - 0.035, z: 0 };
    const dip = { x, y: pip.y - 0.025 * Math.cos(half), z: 0.025 * Math.sin(half) };
    const tip = {
      x,
      y: dip.y - 0.02 * Math.cos(2 * half),
      z: dip.z + 0.02 * Math.sin(2 * half),
    };
    return [knuckle, pip, dip, tip];
  };
  const thumb: Point3[] =
    spec.thumb === "out"
      ? [
          { x: -0.03, y: 0.035, z: 0 },
          { x: -0.058, y: 0.028, z: 0 },
          { x: -0.085, y: 0.02, z: 0 },
          { x: -0.112, y: 0.012, z: 0 }, // tip, far from the fingers
        ]
      : spec.thumb === "tucked"
        ? [
            { x: -0.03, y: 0.035, z: 0 },
            { x: -0.04, y: 0.015, z: 0 },
            { x: -0.03, y: 0.0, z: 0.015 },
            { x: -0.015, y: -0.01, z: 0.02 }, // tip, folded in against the index knuckle
          ]
        : [
            { x: -0.03, y: 0.03, z: 0 },
            { x: -0.045, y: 0.01, z: 0 },
            { x: -0.055, y: -0.01, z: 0 },
            { x: -0.06, y: -0.03, z: 0 },
          ];
  return [
    { x: 0, y: 0.05, z: 0 }, // wrist
    ...thumb,
    ...finger(-0.02, spec.index),
    ...finger(0, spec.middle),
    ...finger(0.02, spec.ring),
    ...finger(0.04, spec.pinky),
  ];
}
