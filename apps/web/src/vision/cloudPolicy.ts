// When to actually call Google Cloud Vision. The live reader scans up to 5 times a second, but a
// page in front of a camera mostly stays the same, and every call costs money (the first 1,000 a
// month are free) and takes about a second. So: read when the picture changes a lot (a page turn,
// the book moved), and otherwise only now and then; in between, reuse the last reading. A hand
// entering the frame changes a few cells of the picture, not most of them, so pointing does not
// trigger a new read. Pure: no browser APIs.
// [ASSUMPTION] The numbers are first values; tune on real use.

export const CLOUD_POLICY = {
  /** Never read more often than this. */
  minIntervalMs: 2000,
  /** Read again after this long even if nothing seems to have changed (a slow drift, a stale read). */
  maxAgeMs: 20_000,
  /** A hard ceiling on reads per minute: protects the free quota and the bill. */
  maxPerMinute: 12,
  /** The share of the little picture's cells that must change for it to count as a new scene. */
  changedShare: 0.35,
  /** A cell changed if its brightness moved by more than this (0-255). */
  cellDelta: 40,
} as const;

/** The share of cells (0-1) whose brightness changed by more than `delta` between two thumbnails. */
export function changedShare(
  a: Uint8Array,
  b: Uint8Array,
  delta: number = CLOUD_POLICY.cellDelta,
): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1;
  let changed = 0;
  for (let i = 0; i < n; i++) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > delta) changed += 1;
  return changed / n;
}

export class CloudGate {
  private last: number | null = null;
  private readonly recent: number[] = [];

  constructor(private readonly policy: typeof CLOUD_POLICY = CLOUD_POLICY) {}

  /**
   * Read now, or reuse the last reading? `changed` is whether the scene has changed since the last
   * read (null when there has not been one yet).
   */
  decide(now: number, changed: boolean | null): "read" | "reuse" {
    while (this.recent.length && now - (this.recent[0] ?? 0) > 60_000) this.recent.shift();
    if (this.recent.length >= this.policy.maxPerMinute) return "reuse";
    if (this.last === null || changed === null) return "read";
    const since = now - this.last;
    if (since < this.policy.minIntervalMs) return "reuse";
    return changed || since >= this.policy.maxAgeMs ? "read" : "reuse";
  }

  /** A read happened at `now`. */
  record(now: number): void {
    this.last = now;
    this.recent.push(now);
  }
}
