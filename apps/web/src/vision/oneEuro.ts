// One Euro filter (Casiez et al., CHI 2012): an adaptive low-pass filter for noisy pointer
// input. When the fingertip is still it smooths hard (kills landmark jitter that would flick the
// highlight between words); when it moves fast the cutoff rises, so the cursor does not lag.

export interface OneEuroParams {
  /** Cutoff at rest, Hz. Lower = steadier when still, more lag on slow moves. */
  minCutoff: number;
  /** How fast the cutoff rises with speed (per normalised image unit per second). */
  beta: number;
  /** Cutoff for the speed estimate, Hz. */
  dCutoff: number;
}

/**
 * [ASSUMPTION] Tuned for normalised (0-1) image coordinates at 15-30 Hz: a tip moving across a
 * line in about a second (~0.5 units/s) raises the cutoff to ~5 Hz. Retune on real footage.
 */
export const FINGERTIP_FILTER: OneEuroParams = { minCutoff: 1.2, beta: 8, dCutoff: 1 };

const alpha = (cutoffHz: number, dtS: number) => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtS);
};

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private at = 0;

  constructor(private readonly params: OneEuroParams = FINGERTIP_FILTER) {}

  /** Filter one sample taken at `atMs`. */
  filter(value: number, atMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.at = atMs;
      return value;
    }
    const dt = Math.max(1e-3, (atMs - this.at) / 1000);
    this.at = atMs;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.params.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}

/** A 2D point through two One Euro filters. */
export class PointFilter {
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;

  constructor(params: OneEuroParams = FINGERTIP_FILTER) {
    this.fx = new OneEuroFilter(params);
    this.fy = new OneEuroFilter(params);
  }

  filter(p: { x: number; y: number }, atMs: number): { x: number; y: number } {
    return { x: this.fx.filter(p.x, atMs), y: this.fy.filter(p.y, atMs) };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
}
