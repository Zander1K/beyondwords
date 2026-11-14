// Flattening lines for reading. Each text line is cut out of the photo along its own centre
// curve and laid level in a strip, so a line that slopes, bows or fans out with its page is read
// like a line on a flat page. The strips are stacked into one tall canvas for the recogniser.
//
// This file only plans the geometry (which part of the photo goes where, under which transform),
// so it can be tested without a canvas; the drawing is a few lines in the OCR worker.
import { pointAt, type Pt, type TextLine } from "./lineFinder";

export const STRIP_TUNING = {
  /** Text height (ascender to descender) as a multiple of the detected stripe's thickness. */
  textPerThickness: 2.0,
  /** The cut is this much taller than the text, so nothing is clipped by a small error. */
  margin: 1.3,
  /** Gap between stacked strips, in pixels. */
  gap: 10,
  /** The cut is never thinner than this (photo pixels). */
  minHeight: 10,
  /**
   * Every strip is scaled to this height (pixels): the height the recogniser works at. Small text
   * is enlarged (and drawn with high-quality smoothing) instead of being left to the recogniser's
   * resize, big text is shrunk. At 960 px wide, where the text is ~6 px tall, this was the
   * difference between reading 71% and 90+% of the words plausibly (see ocr eval notes).
   */
  stripHeight: 48,
} as const;

/** Height of the text on a line (frame pixels). */
export function textHeight(line: TextLine): number {
  return line.thickness * STRIP_TUNING.textPerThickness;
}

/** One piece of a strip: a straight stretch of the curve, drawn under one transform. */
export interface Segment {
  /** Canvas transform [a, b, c, d, e, f] taking a photo pixel to its place in the stack. */
  matrix: [number, number, number, number, number, number];
  /** Where it lands, in the stack (a clip rectangle). */
  clip: { x: number; y: number; w: number; h: number };
  /** The part of the photo to draw (a bounding box of the piece, in photo pixels). */
  source: { x: number; y: number; w: number; h: number };
}

export interface Strip {
  line: TextLine;
  /** Position in the stack. */
  box: { x: number; y: number; width: number; height: number };
  segments: Segment[];
}

export interface StripPlan {
  width: number;
  height: number;
  strips: Strip[];
}

export function planStrips(lines: readonly TextLine[]): StripPlan {
  const { margin, gap, minHeight, stripHeight } = STRIP_TUNING;
  const strips: Strip[] = [];
  let y = 0;
  let width = 1;
  for (const line of lines) {
    // How tall the cut is in the photo, and the scale that makes it `stripHeight` in the stack.
    const cut = Math.max(minHeight, textHeight(line) * margin);
    const k = stripHeight / cut;
    const w = Math.max(1, Math.ceil(line.length * k));
    const segments: Segment[] = [];
    for (let i = 0; i + 1 < line.points.length; i++) {
      const p = line.points[i];
      const q = line.points[i + 1];
      if (!p || !q) continue;
      const alpha = Math.atan2(q.y - p.y, q.x - p.x);
      const cos = Math.cos(alpha);
      const sin = Math.sin(alpha);
      const x0 = (line.arc[i] ?? 0) * k;
      const len = ((line.arc[i + 1] ?? 0) - (line.arc[i] ?? 0)) * k;
      // Photo -> stack: move p to the origin, turn the segment level, scale, and put it at
      // (x0, middle of the strip).
      const e = x0 - k * (p.x * cos + p.y * sin);
      const f = y + stripHeight / 2 + k * (p.x * sin - p.y * cos);
      // The photo area this piece covers: p and q pushed out to either side by half the cut.
      const nx = -sin * (cut / 2);
      const ny = cos * (cut / 2);
      const xs = [p.x + nx, p.x - nx, q.x + nx, q.x - nx];
      const ys = [p.y + ny, p.y - ny, q.y + ny, q.y - ny];
      const sx = Math.floor(Math.min(...xs)) - 2;
      const sy = Math.floor(Math.min(...ys)) - 2;
      segments.push({
        matrix: [k * cos, -k * sin, k * sin, k * cos, e, f],
        clip: { x: x0, y, w: len + 0.75, h: stripHeight },
        source: {
          x: sx,
          y: sy,
          w: Math.ceil(Math.max(...xs)) - sx + 2,
          h: Math.ceil(Math.max(...ys)) - sy + 2,
        },
      });
    }
    strips.push({ line, box: { x: 0, y, width: w, height: stripHeight }, segments });
    width = Math.max(width, w);
    y += stripHeight + gap;
  }
  return { width, height: Math.max(1, y), strips };
}

/** A point at arc length `s` along the line, pushed `t` (-0.5 top .. 0.5 bottom) of the text height. */
export function onLine(line: TextLine, s: number, t: number): Pt {
  const p = pointAt(line, s);
  const d = t * textHeight(line);
  return { x: p.x - Math.sin(p.angle) * d, y: p.y + Math.cos(p.angle) * d };
}
