// OCR: text lines with boxes and baselines from a page still (SIM-VIS-02).
// Tesseract.js runs in its own Web Worker, so the UI thread stays free.
// OPEN QUESTION: browser OCR vs Nemotron VL OCR; compare in eval/ (SIMULATION_FEATURES.md).
// HACK: the worker, WASM core and English model load from Tesseract.js's default CDN on first
// use (~1 s). Vendor them into public/ for an offline demo.
import type { Worker as TesseractWorker } from "tesseract.js";

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

export interface OcrLine {
  text: string;
  box: Box;
  /** The text's baseline: tilted pages make boxes overlap, the baseline does not. */
  baseline: Baseline;
  /** 0-100 */
  confidence: number;
}

export interface OcrResult {
  lines: OcrLine[];
  width: number;
  height: number;
  ms: number;
}

export interface OcrEngine {
  recognize(image: Blob): Promise<OcrResult>;
  dispose(): Promise<void>;
}

/** The raw Tesseract line shape we read (pixels). */
export interface RawLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  baseline: { x0: number; y0: number; x1: number; y1: number };
}

const MIN_CONFIDENCE = 45;

/**
 * Keep real text lines and normalise to 0-1. Drops low-confidence lines and lines that are mostly
 * not letters (page numbers, noise from the book edge or the table).
 */
export function normaliseLines(raw: RawLine[], width: number, height: number): OcrLine[] {
  return raw
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => {
      const letters = (l.text.match(/\p{L}/gu) ?? []).length;
      return l.confidence >= MIN_CONFIDENCE && letters >= 3 && letters / l.text.length > 0.5;
    })
    .map((l) => ({
      text: l.text,
      confidence: l.confidence,
      box: {
        x: l.bbox.x0 / width,
        y: l.bbox.y0 / height,
        w: (l.bbox.x1 - l.bbox.x0) / width,
        h: (l.bbox.y1 - l.bbox.y0) / height,
      },
      baseline: {
        x0: l.baseline.x0 / width,
        y0: l.baseline.y0 / height,
        x1: l.baseline.x1 / width,
        y1: l.baseline.y1 / height,
      },
    }))
    .sort((a, b) => a.box.y - b.box.y);
}

async function imageSize(image: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(image);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export class TesseractOcr implements OcrEngine {
  private worker: Promise<TesseractWorker> | null = null;

  private getWorker(): Promise<TesseractWorker> {
    // Loaded on demand so the rest of the app does not pay for the OCR bundle.
    this.worker ??= import("tesseract.js").then(({ createWorker }) => createWorker("eng"));
    return this.worker;
  }

  async recognize(image: Blob): Promise<OcrResult> {
    const started = performance.now();
    const [worker, { width, height }] = await Promise.all([this.getWorker(), imageSize(image)]);
    const { data } = await worker.recognize(image, {}, { blocks: true });
    const raw: RawLine[] = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    return {
      lines: normaliseLines(raw, width, height),
      width,
      height,
      ms: Math.round(performance.now() - started),
    };
  }

  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) await (await worker).terminate();
  }
}
