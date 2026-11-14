// Finger-only detection on the live video (see fingertip.ts for the method). Owns a small canvas
// the frame is copied onto; everything else is the pure code in fingertip.ts.
import type { Point } from "./handPose";
import { type FingerTip, findFingertip, SkinModel, skinMask, skinSamplePoints } from "./fingertip";

/** Width of the copy the finger is looked for on. ~3 ms per frame at 320 px. */
const SAMPLE_WIDTH = 320;
/** Learn skin colour from a MediaPipe hand at most this often. */
const LEARN_EVERY_MS = 400;
/** A finger must be seen this many frames in a row, near the same place, to count. */
const CONFIRM_FRAMES = 2;
/** "Near the same place" (fraction of the image). */
const SAME_FINGER_DISTANCE = 0.1;

export class FingerDetector {
  readonly skin = new SkinModel();
  private canvas: HTMLCanvasElement | null = null;
  private lastLearnAt = Number.NEGATIVE_INFINITY;
  private last: FingerTip | null = null;
  private seen = 0;

  private read(video: HTMLVideoElement): ImageData | null {
    if (!video.videoWidth || !video.videoHeight) return null;
    const canvas = (this.canvas ??= document.createElement("canvas"));
    const height = Math.max(1, Math.round((SAMPLE_WIDTH * video.videoHeight) / video.videoWidth));
    if (canvas.width !== SAMPLE_WIDTH || canvas.height !== height) {
      canvas.width = SAMPLE_WIDTH;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, height);
    return ctx.getImageData(0, 0, SAMPLE_WIDTH, height);
  }

  /** Learn the user's skin colour from hands MediaPipe found in this frame. */
  learn(video: HTMLVideoElement, hands: readonly (readonly Point[])[], at: number): void {
    if (!hands.length || at - this.lastLearnAt < LEARN_EVERY_MS) return;
    this.lastLearnAt = at;
    const image = this.read(video);
    if (!image) return;
    const { data, width, height } = image;
    const pixels: { r: number; g: number; b: number }[] = [];
    for (const hand of hands) {
      for (const p of skinSamplePoints(hand)) {
        const x = Math.min(width - 1, Math.round(p.x * (width - 1)));
        const y = Math.min(height - 1, Math.round(p.y * (height - 1)));
        const i = (y * width + x) * 4;
        pixels.push({ r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 });
      }
    }
    this.skin.learn(pixels);
  }

  /** A fingertip on a frame where MediaPipe found no hand; null if none (or not confirmed yet). */
  detect(video: HTMLVideoElement): FingerTip | null {
    const image = this.read(video);
    const found = image
      ? findFingertip(
          skinMask(image.data, image.width, image.height, this.skin),
          image.width,
          image.height,
          image.data,
        )
      : null;
    const near =
      found &&
      this.last &&
      Math.hypot(found.tip.x - this.last.tip.x, found.tip.y - this.last.tip.y) <
        SAME_FINGER_DISTANCE;
    this.seen = found ? (near ? this.seen + 1 : 1) : 0;
    this.last = found;
    return found && this.seen >= CONFIRM_FRAMES ? found : null;
  }

  /** Forget the finger being confirmed (MediaPipe has the hand again). */
  clear(): void {
    this.last = null;
    this.seen = 0;
  }
}
