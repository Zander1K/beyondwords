// Camera stand-in for the Neural Band: recognise the six actions from hands the camera sees.
// The real band reads wrist muscles, not video; in the simulation the camera is the only
// "eyes", so hand shapes stand in for the band's gestures:
//
//   thumb + index pinch     -> select   (same as the band's thumb-index pinch)
//   thumb + middle pinch    -> back     (same as the band's thumb-middle pinch)
//   open palm swipe  <- ->  -> left / right
//   open palm swipe  up/dn  -> up / down
//
// A pointing index finger is the reading cursor (app vision), never a gesture.
// [ASSUMPTION] Thresholds are first guesses; tune on real footage.
import type { GlassesGesture } from "../adapter";
import { classifyPose, type Hand, type Hand3, palmCentre, type Point } from "@/vision/handPose";

export const CAMERA_GESTURE_TUNING = {
  /** Frames a pinch must hold before it counts (filters brief touches). */
  pinchFrames: 2,
  /** Palm travel (fraction of the image) within the window that counts as a swipe. */
  swipeDistance: 0.15,
  swipeWindowMs: 450,
  /** The main direction must dominate the other axis by this factor. */
  swipeDominance: 1.6,
  /** Quiet time after any camera gesture. */
  cooldownMs: 600,
} as const;

interface HandTrack {
  pinch: "index" | "middle" | null;
  pinchFrames: number;
  fired: boolean;
  palm: { at: number; p: Point }[];
}

export class CameraGestureRecognizer {
  private tracks: HandTrack[] = [];
  private lastFiredAt = Number.NEGATIVE_INFINITY;

  /**
   * @param mirrored flip left/right swipes (for a camera facing the user, like a laptop webcam;
   * a glasses camera looks the same way as the wearer, so the default is not mirrored).
   */
  constructor(private readonly options: { mirrored?: () => boolean } = {}) {}

  /**
   * Feed one frame of hands; returns the gestures recognised in it. `worlds` are the hands' 3D
   * landmarks (same order), when the tracker has them.
   */
  update(
    hands: readonly Hand[],
    at: number,
    worlds: readonly (Hand3 | undefined)[] = [],
  ): GlassesGesture[] {
    const out: GlassesGesture[] = [];
    // HACK: hands are matched to tracks by index; MediaPipe keeps a stable order while tracking.
    this.tracks.length = hands.length;
    hands.forEach((hand, i) => {
      const track = (this.tracks[i] ??= { pinch: null, pinchFrames: 0, fired: false, palm: [] });
      const gesture = this.updateHand(track, hand, at, worlds[i]);
      if (gesture && at - this.lastFiredAt >= CAMERA_GESTURE_TUNING.cooldownMs) {
        this.lastFiredAt = at;
        out.push(gesture);
      }
    });
    return out;
  }

  private updateHand(
    track: HandTrack,
    hand: Hand,
    at: number,
    world: Hand3 | undefined,
  ): GlassesGesture | null {
    const pose = classifyPose(hand, track.pinch, world);

    // Pinches fire once on the way in; the fingers must part before the next one.
    const pinch = pose === "pinch-index" ? "index" : pose === "pinch-middle" ? "middle" : null;
    if (pinch) {
      if (track.pinch !== pinch) {
        track.pinch = pinch;
        track.pinchFrames = 0;
        track.fired = false;
      }
      track.pinchFrames += 1;
      track.palm = [];
      if (!track.fired && track.pinchFrames >= CAMERA_GESTURE_TUNING.pinchFrames) {
        track.fired = true;
        return pinch === "index" ? "select" : "back";
      }
      return null;
    }
    track.pinch = null;
    track.pinchFrames = 0;
    track.fired = false;

    // Swipes: an open palm travelling quickly in one direction.
    if (pose !== "open-palm") {
      track.palm = [];
      return null;
    }
    track.palm.push({ at, p: palmCentre(hand) });
    track.palm = track.palm.filter((s) => at - s.at <= CAMERA_GESTURE_TUNING.swipeWindowMs);
    const first = track.palm[0];
    const last = track.palm[track.palm.length - 1];
    if (!first || !last) return null;
    let dx = last.p.x - first.p.x;
    const dy = last.p.y - first.p.y;
    if (this.options.mirrored?.()) dx = -dx;
    const { swipeDistance, swipeDominance } = CAMERA_GESTURE_TUNING;
    let gesture: GlassesGesture | null = null;
    if (Math.abs(dx) >= swipeDistance && Math.abs(dx) >= Math.abs(dy) * swipeDominance) {
      gesture = dx > 0 ? "right" : "left";
    } else if (Math.abs(dy) >= swipeDistance && Math.abs(dy) >= Math.abs(dx) * swipeDominance) {
      gesture = dy > 0 ? "down" : "up";
    }
    if (gesture) track.palm = [];
    return gesture;
  }
}
