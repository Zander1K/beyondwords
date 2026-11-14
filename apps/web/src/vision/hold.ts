// Hold detection: fires once when something has been true for long enough, with a progress value
// for a "keep holding" ring. Used for the pose that shows or hides the controls: a quick pose
// (closing the hand to turn a page, a tracking blip) must not toggle anything.
// No React, no browser APIs.

export const HOLD_TUNING = {
  /** How long the pose is held. [ASSUMPTION] long enough to be deliberate, short enough to feel quick. */
  holdMs: 900,
  /** A gap this short (a missed detection) does not restart the hold. */
  graceMs: 250,
} as const;

export interface HoldState {
  /** 0-1: how far through the hold. */
  progress: number;
  /** True on the one frame the hold completes; it must be released before it can fire again. */
  fired: boolean;
}

export class HoldDetector {
  private since: number | null = null;
  private lastActive = Number.NEGATIVE_INFINITY;
  private done = false;

  constructor(
    private readonly holdMs: number = HOLD_TUNING.holdMs,
    private readonly graceMs: number = HOLD_TUNING.graceMs,
  ) {}

  /** Feed one frame: whether the pose is present at `now` (ms). */
  update(active: boolean, now: number): HoldState {
    if (active) {
      this.lastActive = now;
      if (this.since === null) this.since = now;
    } else if (this.since !== null && now - this.lastActive > this.graceMs) {
      this.since = null;
      this.done = false;
    }
    if (this.since === null) return { progress: 0, fired: false };
    const progress = Math.min(1, (now - this.since) / this.holdMs);
    if (progress >= 1 && !this.done) {
      this.done = true;
      return { progress, fired: true };
    }
    return { progress: this.done ? 1 : progress, fired: false };
  }

  reset(): void {
    this.since = null;
    this.done = false;
    this.lastActive = Number.NEGATIVE_INFINITY;
  }
}
