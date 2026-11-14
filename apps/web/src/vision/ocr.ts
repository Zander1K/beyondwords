// OCR: text lines and words with positions from a page still (SIM-VIS-02).
// PaddleOCR runs in a Web Worker (paddleOcr.worker.ts); this file is the main-thread client and
// the conversion to our line/word model.
// OPEN QUESTION: browser OCR vs Nemotron VL OCR; compare in eval/ (SIMULATION_FEATURES.md).
import type { WorkerItem, WorkerRequest, WorkerResponse } from "./paddleOcr.worker";

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
}

export interface OcrResult {
  lines: OcrLine[];
  width: number;
  height: number;
  ms: number;
  /** The page had to be flattened first (tilted or curled). */
  unwarped: boolean;
  /** The flattening pass ran this time. */
  unwarpTried: boolean;
}

export interface OcrEngine {
  recognize(image: Blob): Promise<OcrResult>;
  dispose(): void;
}

/**
 * Rough relative width of a character in a proportional book font. Paddle returns one box per
 * line (or word group), so word positions inside it are estimated from character widths.
 * [ASSUMPTION] Good to a fraction of a word; real per-word boxes would need character timings.
 */
export function charWidth(ch: string): number {
  if (ch === " ") return 0.55;
  if (/[iljtf.,:;'!|()1\-‘’“”"]/.test(ch)) return 0.5;
  if (/[mwMW]/.test(ch)) return 1.45;
  if (/[A-Z]/.test(ch)) return 1.2;
  return 1;
}

/** Split one recognised item (pixels) into words with estimated boxes (pixels). */
export function splitItem(item: WorkerItem): { text: string; x: number; w: number }[] {
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

/** Paddle lines (pixels, words grouped per line) -> our normalised lines with word boxes. */
export function toOcrLines(lines: WorkerItem[][], width: number, height: number): OcrLine[] {
  const out: OcrLine[] = [];
  for (const items of lines) {
    const kept = items.filter((i) => i.text.trim());
    if (!kept.length) continue;
    const confidence = kept.reduce((s, i) => s + i.confidence, 0) / kept.length;
    if (confidence < MIN_LINE_CONFIDENCE) continue;

    const left = Math.min(...kept.map((i) => i.box.x));
    const top = Math.min(...kept.map((i) => i.box.y));
    const right = Math.max(...kept.map((i) => i.box.x + i.box.width));
    const bottom = Math.max(...kept.map((i) => i.box.y + i.box.height));

    const words: OcrWord[] = [];
    let text = "";
    for (const item of [...kept].sort((a, b) => a.box.x - b.box.x)) {
      for (const w of splitItem(item)) {
        if (text) text += " ";
        const start = text.length;
        text += w.text;
        words.push({
          text: w.text,
          start,
          end: text.length,
          box: {
            x: w.x / width,
            y: item.box.y / height,
            w: w.w / width,
            h: item.box.height / height,
          },
        });
      }
    }
    const letters = (text.match(/\p{L}/gu) ?? []).length;
    if (letters < 2) continue; // page numbers, specks

    const baseY = (top + (bottom - top) * BASELINE_AT) / height;
    out.push({
      text,
      words,
      confidence: Math.round(confidence * 100),
      box: {
        x: left / width,
        y: top / height,
        w: (right - left) / width,
        h: (bottom - top) / height,
      },
      baseline: { x0: left / width, y0: baseY, x1: right / width, y1: baseY },
    });
  }
  return out.sort((a, b) => a.box.y - b.box.y);
}

async function imageSize(image: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(image);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
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

  private request(image: ImageBitmap | ArrayBuffer, allowUnwarp: boolean): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise<WorkerResponse>((resolve) => {
      this.pending.set(id, resolve);
      const request: WorkerRequest = { id, image, allowUnwarp };
      this.getWorker().postMessage(request, [image]);
    });
  }

  private toResult(response: WorkerResponse, width: number, height: number): OcrResult {
    if (!response.ok) throw new Error(`OCR failed: ${response.error}`);
    return {
      lines: toOcrLines(response.lines, width, height),
      width,
      height,
      ms: response.ms,
      unwarped: response.unwarped,
      unwarpTried: response.unwarpTried,
    };
  }

  /** An uploaded photo (or any encoded image). Always allowed to flatten the page. */
  async recognize(image: Blob): Promise<OcrResult> {
    const [{ width, height }, buffer] = await Promise.all([imageSize(image), image.arrayBuffer()]);
    return this.toResult(await this.request(buffer, true), width, height);
  }

  /**
   * A live frame (continuous scanning). The bitmap is transferred to the worker (no copy, no
   * JPEG round trip). `allowUnwarp` gates the slow flattening pass.
   */
  async recognizeFrame(frame: ImageBitmap, allowUnwarp: boolean): Promise<OcrResult> {
    const { width, height } = frame;
    return this.toResult(await this.request(frame, allowUnwarp), width, height);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
