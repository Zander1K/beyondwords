// OCR: text lines and words with positions from live camera frames (SIM-VIS-02).
// PaddleOCR runs in a Web Worker (paddleOcr.worker.ts), which finds each line along its own curve
// and reads it flattened; this file is the main-thread client and the conversion of those reads
// to our line/word model.
// OPEN QUESTION: browser OCR vs Nemotron VL OCR; compare in eval/ (SIMULATION_FEATURES.md).
import type { TextLine } from "./lineFinder";
import type { WorkerRequest, WorkerResponse } from "./paddleOcr.worker";
import { onLine, textHeight } from "./strips";

/** Normalised 0-1 coordinates of the image (top-left origin). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Baseline {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /**
   * Height of the text above it (normalised to the image height). On a tilted page the line's
   * axis-aligned box is much taller than its text; distances to the line use this.
   */
  height?: number;
  /**
   * How far the line sags below its straight chord at the middle (normalised to the image
   * height; negative = bows up). A curled page's lines bow up to ~0.8 of a text height; the line
   * is the chord plus a parabola through this: y(t) = chord(t) + bow * 4t(1-t), t = 0..1.
   */
  bow?: number;
}

export interface OcrWord {
  text: string;
  box: Box;
  /** [start, end) character offsets of the word in its line's text. */
  start: number;
  end: number;
}

export interface OcrLine {
  text: string;
  box: Box;
  /** Estimated baseline, used to pick the line the fingertip is under. */
  baseline: Baseline;
  words: OcrWord[];
  /** 0-100 */
  confidence: number;
  /** Which page (or column) of an open book the line is on, in reading order (0 = left). */
  block: number;
}

export interface OcrResult {
  lines: OcrLine[];
  width: number;
  height: number;
  ms: number;
  /** Time in the text detector, ms (the rest is reading the lines). */
  detectMs: number;
  /** Lines that kept their last reading instead of being recognised again. */
  reused: number;
  /** Pages (or columns) found: 2 on an open book, 1 on a single page. */
  blocks: number;
}

export interface OcrEngine {
  /** Read one live camera frame. */
  recognizeFrame(frame: ImageBitmap): Promise<OcrResult>;
  dispose(): void;
}

/**
 * Rough relative width of a character in a proportional book font. The recogniser returns one
 * text per line, so word positions inside it are estimated from character widths.
 * [ASSUMPTION] Good to a fraction of a word; real per-word boxes would need character timings.
 */
export function charWidth(ch: string): number {
  if (ch === " ") return 0.55;
  if (/[iljtf.,:;'!|()1\-‘’“”"]/.test(ch)) return 0.5;
  if (/[mwMW]/.test(ch)) return 1.45;
  if (/[A-Z]/.test(ch)) return 1.2;
  return 1;
}

/** A recognised piece of text and where it spans (x, width in pixels along its line). */
export interface RecognisedItem {
  text: string;
  box: { x: number; y: number; width: number; height: number };
  confidence: number;
}

/** Split one recognised item into words with estimated positions along it. */
export function splitItem(item: RecognisedItem): { text: string; x: number; w: number }[] {
  const text = item.text.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const total = [...text].reduce((s, ch) => s + charWidth(ch), 0);
  const scale = item.box.width / total;
  const words: { text: string; x: number; w: number }[] = [];
  let offset = 0;
  for (const token of text.split(" ")) {
    const width = [...token].reduce((s, ch) => s + charWidth(ch), 0) * scale;
    words.push({ text: token, x: item.box.x + offset, w: width });
    offset += width + charWidth(" ") * scale;
  }
  return words;
}

/** Where the baseline sits within a text box, as a fraction of its height. [ASSUMPTION] */
const BASELINE_AT = 0.78;
/** Minimum mean confidence (0-1) to keep a line: below it, it is usually noise. */
const MIN_LINE_CONFIDENCE = 0.5;

/** One line read from a flattened strip: the line's curve, what it says, how sure the read is. */
export interface StripRead {
  line: TextLine;
  text: string;
  /** 0-1 */
  confidence: number;
  /** Page (or column) of an open book, in reading order. */
  block: number;
}

/**
 * Flattened-strip reads -> our normalised lines with word boxes. Words are placed along the
 * line's own curve (so a sloped or bowed line gets sloped, bowed word boxes) and the line's
 * baseline runs along that curve from end to end. Lines come out page by page, top to bottom.
 */
export function stripReadsToLines(reads: StripRead[], width: number, height: number): OcrLine[] {
  const out: OcrLine[] = [];
  for (const read of reads) {
    if (read.confidence < MIN_LINE_CONFIDENCE) continue;
    const { line } = read;
    const th = textHeight(line);
    const items = splitItem({
      text: read.text,
      box: { x: 0, y: 0, width: line.length, height: th },
      confidence: read.confidence,
    });
    const words: OcrWord[] = [];
    let text = "";
    for (const w of items) {
      if (text) text += " ";
      const start = text.length;
      text += w.text;
      const corners = [
        onLine(line, w.x, -0.5),
        onLine(line, w.x + w.w, -0.5),
        onLine(line, w.x + w.w, 0.5),
        onLine(line, w.x, 0.5),
      ];
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      words.push({
        text: w.text,
        start,
        end: text.length,
        box: {
          x: left / width,
          y: top / height,
          w: (Math.max(...xs) - left) / width,
          h: (Math.max(...ys) - top) / height,
        },
      });
    }
    const letters = (text.match(/\p{L}/gu) ?? []).length;
    if (letters < 2) continue; // page numbers, ornaments, specks

    // Baseline: the text's bottom edge less the descenders, along the curve end to end.
    const b0 = onLine(line, 0, BASELINE_AT - 0.5);
    const b1 = onLine(line, line.length, BASELINE_AT - 0.5);
    // The curve's middle against the middle of the chord, vertically.
    const bm = onLine(line, line.length / 2, BASELINE_AT - 0.5);
    const allX = words.flatMap((w) => [w.box.x, w.box.x + w.box.w]);
    const allY = words.flatMap((w) => [w.box.y, w.box.y + w.box.h]);
    const left = Math.min(...allX);
    const top = Math.min(...allY);
    out.push({
      text,
      words,
      confidence: Math.round(read.confidence * 100),
      box: { x: left, y: top, w: Math.max(...allX) - left, h: Math.max(...allY) - top },
      baseline: {
        x0: b0.x / width,
        y0: b0.y / height,
        x1: b1.x / width,
        y1: b1.y / height,
        height: th / height,
        bow: (bm.y - (b0.y + b1.y) / 2) / height,
      },
      block: read.block,
    });
  }
  // Reading order: page by page; within a page, top to bottom where each baseline crosses the
  // page's middle.
  const mids = new Map<number, number>();
  for (const block of new Set(out.map((l) => l.block))) {
    const xs = out.filter((l) => l.block === block).flatMap((l) => [l.baseline.x0, l.baseline.x1]);
    mids.set(block, (Math.min(...xs) + Math.max(...xs)) / 2);
  }
  const yAt = (l: OcrLine) => {
    const { x0, y0, x1, y1 } = l.baseline;
    const mid = mids.get(l.block) ?? 0.5;
    return x1 === x0 ? y0 : y0 + ((y1 - y0) * (mid - x0)) / (x1 - x0);
  };
  return out.sort((a, b) => a.block - b.block || yAt(a) - yAt(b));
}

/** PaddleOCR in a Web Worker. The worker and its models load on the first scan. */
export class PaddleOcr implements OcrEngine {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, (r: WorkerResponse) => void>();

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./paddleOcr.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.pending.get(event.data.id)?.(event.data);
        this.pending.delete(event.data.id);
      };
    }
    return this.worker;
  }

  private request(image: ImageBitmap): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise<WorkerResponse>((resolve) => {
      this.pending.set(id, resolve);
      const request: WorkerRequest = { id, image };
      this.getWorker().postMessage(request, [image]);
    });
  }

  /**
   * A live frame (continuous scanning). The bitmap is transferred to the worker (no copy, no
   * JPEG round trip).
   */
  async recognizeFrame(frame: ImageBitmap): Promise<OcrResult> {
    const { width, height } = frame;
    const response = await this.request(frame);
    if (!response.ok) throw new Error(`OCR failed: ${response.error}`);
    return {
      lines: stripReadsToLines(response.reads, width, height),
      width,
      height,
      ms: response.ms,
      detectMs: response.detectMs,
      reused: response.reused,
      blocks: response.blocks,
    };
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
