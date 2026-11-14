// Text lines from the detector's probability map.
//
// PaddleOCR's detector outputs a map of how text-like each pixel is. On a photo of an open book
// that map is excellent: every line is its own clean stripe, however much the page curls and
// slopes. What goes wrong is what the library does next: it turns each stripe into the
// axis-aligned rectangle around it (padded 40% taller and 60% wider), and on a line that slopes
// 8 degrees that rectangle covers parts of the lines above and below. Recognition then reads
// garbage or nothing. Measured on photos of the demo book: about 20% of the words got read.
//
// Here each stripe is kept as it is: a centre curve (a quadratic fitted through the stripe) and
// a thickness. strips.ts then flattens each line along its own curve before it is read.
// Pure functions on a Float32Array map; no browser APIs.

export interface Pt {
  x: number;
  y: number;
}

export interface TextLine {
  /** The centre curve left to right, in frame pixels, ends extended past the stripe. */
  points: Pt[];
  /** Arc length at each point (frame pixels): arc[0] = 0, arc[last] = length. */
  arc: number[];
  /** Length of the curve, frame pixels. */
  length: number;
  /** Median thickness of the detected stripe, frame pixels. */
  thickness: number;
  /**
   * Where the detected stripe itself spans across the frame (frame pixels), before the ends are
   * extended. Page splitting uses this: the extended ends can reach across a narrow gutter.
   */
  core: { left: number; right: number };
}

export const FIND_TUNING = {
  /** A pixel counts as text above this probability. 0.3 is the DB detector's standard cut. */
  threshold: 0.3,
  /** Smallest stripe, in map pixels. */
  minArea: 60,
  /** The stripe is measured in slices this wide (map pixels). */
  bin: 6,
  /** Spacing of the points on the centre curve (frame pixels). */
  step: 16,
  /** A text line is at least this many times longer than it is thick. */
  minElongation: 2.5,
  /** Steeper than this is not a line of text (the page is not read sideways). */
  maxAngleDeg: 40,
  /** Thinner than this (map pixels) is noise. */
  minThickness: 3,
  /**
   * The detector's stripe ends a little short of the text, so the line runs this much (x the
   * stripe's thickness) further at each end. At 0.6 the last letter of a line was often clipped
   * ("lipstick an", "looked at he"); from 1.0 up it is not (clipped line ends 6 -> 3 in 146 on
   * photos of the demo book). 1.5 leaves margin for the recogniser, which wants some blank at
   * the end. Longer reached across the gutter, which is why the pages are split on `core`.
   */
  extend: 1.5,
} as const;

type Tuning = { -readonly [K in keyof typeof FIND_TUNING]: number };

/** Least-squares quadratic v = a + b*t + c*t^2 through (t, v) with weights. */
function fitQuadratic(ts: number[], vs: number[], ws: number[]): [number, number, number] {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let r0 = 0;
  let r1 = 0;
  let r2 = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i] ?? 0;
    const v = vs[i] ?? 0;
    const w = ws[i] ?? 1;
    const t2 = t * t;
    s0 += w;
    s1 += w * t;
    s2 += w * t2;
    s3 += w * t2 * t;
    s4 += w * t2 * t2;
    r0 += w * v;
    r1 += w * v * t;
    r2 += w * v * t2;
  }
  // Solve [[s0 s1 s2][s1 s2 s3][s2 s3 s4]] * [a b c] = [r0 r1 r2] (Cramer's rule).
  const det3 = (a: number[], b: number[], c: number[]) =>
    (a[0] ?? 0) * ((b[1] ?? 0) * (c[2] ?? 0) - (b[2] ?? 0) * (c[1] ?? 0)) -
    (a[1] ?? 0) * ((b[0] ?? 0) * (c[2] ?? 0) - (b[2] ?? 0) * (c[0] ?? 0)) +
    (a[2] ?? 0) * ((b[0] ?? 0) * (c[1] ?? 0) - (b[1] ?? 0) * (c[0] ?? 0));
  const d = det3([s0, s1, s2], [s1, s2, s3], [s2, s3, s4]);
  if (Math.abs(d) < 1e-9) return [r0 / (s0 || 1), 0, 0];
  const a = det3([r0, s1, s2], [r1, s2, s3], [r2, s3, s4]) / d;
  const b = det3([s0, r0, s2], [s1, r1, s3], [s2, r2, s4]) / d;
  const c = det3([s0, s1, r0], [s1, s2, r1], [s2, s3, r2]) / d;
  return [a, b, c];
}

/** Text lines in a probability map (`w` x `h`), in frame pixels (`scale` = frame px per map px). */
export function findLines(
  map: Float32Array,
  w: number,
  h: number,
  scale = 1,
  tuning: Partial<Tuning> = {},
): TextLine[] {
  const t: Tuning = { ...FIND_TUNING, ...tuning };
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const lines: TextLine[] = [];

  for (let seed = 0; seed < map.length; seed++) {
    if (seen[seed] || (map[seed] ?? 0) <= t.threshold) continue;
    // Flood fill one stripe; its pixels end up in queue[0..tail).
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    seen[seed] = 1;
    while (head < tail) {
      const p = queue[head++] ?? 0;
      const x = p % w;
      const y = (p - x) / w;
      const visit = (q: number) => {
        if (!seen[q] && (map[q] ?? 0) > t.threshold) {
          seen[q] = 1;
          queue[tail++] = q;
        }
      };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (y > 0) visit(p - w);
      if (y < h - 1) visit(p + w);
    }
    if (tail < t.minArea) continue;

    // Principal axis of the stripe.
    let mx = 0;
    let my = 0;
    for (let i = 0; i < tail; i++) {
      const p = queue[i] ?? 0;
      mx += p % w;
      my += Math.floor(p / w);
    }
    mx /= tail;
    my /= tail;
    let cxx = 0;
    let cxy = 0;
    let cyy = 0;
    for (let i = 0; i < tail; i++) {
      const p = queue[i] ?? 0;
      const dx = (p % w) - mx;
      const dy = Math.floor(p / w) - my;
      cxx += dx * dx;
      cxy += dx * dy;
      cyy += dy * dy;
    }
    const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    if (Math.abs(theta) > (t.maxAngleDeg * Math.PI) / 180) continue;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);

    // Slice the stripe along its axis: each slice gives a centre (mean v) and a thickness.
    let uMin = Infinity;
    let uMax = -Infinity;
    for (let i = 0; i < tail; i++) {
      const p = queue[i] ?? 0;
      const u = ((p % w) - mx) * cos + (Math.floor(p / w) - my) * sin;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
    }
    const bins = Math.max(1, Math.ceil((uMax - uMin + 1) / t.bin));
    const sumV = new Float64Array(bins);
    const minV = new Float64Array(bins).fill(Infinity);
    const maxV = new Float64Array(bins).fill(-Infinity);
    const count = new Uint32Array(bins);
    for (let i = 0; i < tail; i++) {
      const p = queue[i] ?? 0;
      const dx = (p % w) - mx;
      const dy = Math.floor(p / w) - my;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      const b = Math.min(bins - 1, Math.floor((u - uMin) / t.bin));
      sumV[b] = (sumV[b] ?? 0) + v;
      if (v < (minV[b] ?? 0)) minV[b] = v;
      if (v > (maxV[b] ?? 0)) maxV[b] = v;
      count[b] = (count[b] ?? 0) + 1;
    }
    const us: number[] = [];
    const vs: number[] = [];
    const ws: number[] = [];
    const thick: number[] = [];
    for (let b = 0; b < bins; b++) {
      const n = count[b] ?? 0;
      if (!n) continue;
      us.push(uMin + (b + 0.5) * t.bin);
      vs.push((sumV[b] ?? 0) / n);
      ws.push(n);
      thick.push((maxV[b] ?? 0) - (minV[b] ?? 0) + 1);
    }
    thick.sort((a, b) => a - b);
    const thickness = thick[Math.floor(thick.length / 2)] ?? 0;
    const span = uMax - uMin;
    if (thickness < t.minThickness || span < t.minElongation * thickness) continue;

    // The centre curve: a quadratic in u (normalised for stability), extended past the ends.
    const half = Math.max(Math.abs(uMin), Math.abs(uMax), 1);
    const [a, b, c] = fitQuadratic(
      us.map((u) => u / half),
      vs,
      ws,
    );
    const curveV = (u: number) => a + b * (u / half) + c * (u / half) ** 2;
    const ext = t.extend * thickness;
    const from = uMin - ext;
    const to = uMax + ext;
    const n = Math.max(2, Math.ceil(((to - from) * scale) / t.step) + 1);
    const xAt = (u: number) => (mx + u * cos - curveV(u) * sin) * scale;
    const coreEnds = [xAt(uMin), xAt(uMax)];
    const points: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const u = from + ((to - from) * i) / (n - 1);
      const v = curveV(u);
      points.push({ x: (mx + u * cos - v * sin) * scale, y: (my + u * sin + v * cos) * scale });
    }
    const arc: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1];
      const q = points[i];
      arc.push(
        (arc[i - 1] ?? 0) + Math.hypot((q?.x ?? 0) - (p?.x ?? 0), (q?.y ?? 0) - (p?.y ?? 0)),
      );
    }
    lines.push({
      points,
      arc,
      length: arc[arc.length - 1] ?? 0,
      thickness: thickness * scale,
      core: { left: Math.min(...coreEnds), right: Math.max(...coreEnds) },
    });
  }
  return lines;
}

/** Where along a line's curve `s` (arc length) is: the point and the angle of the curve there. */
export function pointAt(line: TextLine, s: number): { x: number; y: number; angle: number } {
  const { points, arc } = line;
  const last = points.length - 1;
  const clamped = Math.max(0, Math.min(line.length, s));
  let k = 0;
  while (k < last - 1 && (arc[k + 1] ?? 0) < clamped) k++;
  const p = points[k];
  const q = points[k + 1];
  if (!p || !q) return { x: p?.x ?? 0, y: p?.y ?? 0, angle: 0 };
  const segment = (arc[k + 1] ?? 0) - (arc[k] ?? 0) || 1;
  // Beyond the ends, keep going straight along the end segment.
  const f = (s - (arc[k] ?? 0)) / segment;
  return {
    x: p.x + (q.x - p.x) * f,
    y: p.y + (q.y - p.y) * f,
    angle: Math.atan2(q.y - p.y, q.x - p.x),
  };
}

export interface BlockSplit {
  /** Block (page or column) of each line, in reading order; all 0 when there is no gutter. */
  block: number[];
  /** x of the gap's middle (frame pixels), or null. */
  gutter: number | null;
}

export const GUTTER_TUNING = {
  /** Narrowest gap (fraction of the frame width) that separates two pages. */
  minGap: 0.012,
  /** Each side needs at least this many lines. */
  minLines: 3,
} as const;

/**
 * Which page (or column) each line is on. A gutter is a stretch of the frame's width that no
 * line covers, with lines on both sides: on an open book, the space between the two pages.
 */
export function splitBlocks(lines: TextLine[], frameWidth: number): BlockSplit {
  const none: BlockSplit = { block: lines.map(() => 0), gutter: null };
  if (lines.length < 2 * GUTTER_TUNING.minLines) return none;
  const extents = lines.map((l) => ({ left: l.core.left, right: l.core.right }));
  // Lines sorted by their left edge; a gap is where the next line starts well after the
  // furthest right edge so far.
  const order = extents
    .map((_, i) => i)
    .sort((a, b) => (extents[a]?.left ?? 0) - (extents[b]?.left ?? 0));
  let reach = extents[order[0] ?? 0]?.right ?? 0;
  let best: { at: number; gap: number; before: number } | null = null;
  for (let k = 1; k < order.length; k++) {
    const e = extents[order[k] ?? 0];
    if (!e) continue;
    const gap = e.left - reach;
    if (gap >= GUTTER_TUNING.minGap * frameWidth && (!best || gap > best.gap)) {
      best = { at: reach + gap / 2, gap, before: k };
    }
    reach = Math.max(reach, e.right);
  }
  if (
    !best ||
    best.before < GUTTER_TUNING.minLines ||
    order.length - best.before < GUTTER_TUNING.minLines
  ) {
    return none;
  }
  return { block: extents.map((e) => ((e.left + e.right) / 2 < best.at ? 0 : 1)), gutter: best.at };
}
