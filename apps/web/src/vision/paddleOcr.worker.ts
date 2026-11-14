// PaddleOCR in a Web Worker, so recognition never blocks the camera view or hand tracking.
// Uses ppu-paddle-ocr (PaddleOCR PP-OCRv6 via ONNX Runtime Web; WebGPU when available, else
// WASM). PP-OCRv6 small (31 MB, downloaded once): on a webcam-like page it read 95% of words vs
// 75% for tiny; v6 medium was no better and 4x slower.
//
// How a frame is read (the library's own pipeline is NOT used, because it fails on a book held
// in the hand; the numbers are from photos of the demo book):
//
//   1. Detect: the library's detector gives a map of how text-like each pixel is. On a photo of
//      an open book that map is excellent: every line a clean separate stripe, however the page
//      curls and slopes, with a clear gap between the two pages.
//   2. Find lines (lineFinder.ts): each stripe becomes a centre curve and a thickness, and the
//      gap splits the pages. The library does this step with axis-aligned padded rectangles,
//      which on a line sloping 8 degrees cover the lines above and below it: only ~20% of the
//      words were read (174 words in two photos holding ~1,500) and the two pages merged.
//   3. Flatten (strips.ts): each line is cut out along its own curve and laid level, scaled to
//      the 48 px height the recogniser works at, and the strips are stacked into one canvas.
//   4. Recognise the strips with the library's recogniser.
//   5. Remember each line (lineSignature.ts): a line that looks the same next frame keeps its
//      reading and is not recognised again. A spread is ~70 lines and recognising them is almost
//      all of the time; the detector is the floor. Every few frames everything is read afresh,
//      and lines the recogniser was unsure of are always read again.
//
// Two photos of the demo book at 1920 px: 1,497 words read, 98% plausible (vs 174 words, 84%);
// at 1280 px 98%, at 960 px (text ~6 px tall) 97%, where cutting strips at photo scale gave 71%.
//
// The detector and recogniser are the service's internals (`detector`, `recognitor`):
// HACK: they are not part of the library's typed API. The library version is pinned in
// package.json; if it changes, the check in `internals()` fails loudly.
// HACK: models load from the library's model repos (GitHub / Hugging Face) on first use and are
// cached by the browser. Vendor them for an offline demo.
import { PaddleOcrService, type PaddleOptions, V6_SMALL_MODEL } from "ppu-paddle-ocr/web";

import { findLines, splitBlocks, type TextLine } from "./lineFinder";
import { lineSignature, matchLine, type RememberedLine } from "./lineSignature";
import type { StripRead } from "./ocr";
import { planStrips } from "./strips";

export interface WorkerRequest {
  id: number;
  /** A live video frame. */
  image: ImageBitmap;
}

export type WorkerResponse =
  | {
      id: number;
      ok: true;
      /** Lines in the order they were found; the main thread puts them in reading order. */
      reads: StripRead[];
      /** Pages (or columns) found: 2 on an open book. */
      blocks: number;
      /** Time in the detector, ms. */
      detectMs: number;
      /** Lines that kept their last reading (not recognised again this frame). */
      reused: number;
      ms: number;
    }
  | { id: number; ok: false; error: string };

const options = {
  model: V6_SMALL_MODEL,
  // The web build has no OpenCV image processor; canvas-native is what runs in the browser.
  processing: { engine: "canvas-native" as const },
  // Native resolution for webcam frames (default "auto" detects a 1920 px frame at 1440 px).
  detection: { maxSideLength: 1920 },
  // The stack of strips is tall; the default would shrink it to 2000 px, and the strips with it.
  recognition: { maxCropSourceSideLength: 16384 } as PaddleOptions["recognition"],
};

/** Mid grey between the stacked strips: neither ink nor paper. */
const NEUTRAL = "#808080";

/** Read every line afresh every this many frames, whatever it looks like. */
const FULL_READ_EVERY = 6;
/** A line read with less confidence than this is read again next frame. */
const REUSE_MIN_CONFIDENCE = 0.9;

/** The lines of the last frame, with their readings. */
let remembered: RememberedLine[] = [];
let framesSinceFull = 0;

let loading: Promise<PaddleOcrService> | null = null;

function service(): Promise<PaddleOcrService> {
  return (loading ??= (async () => {
    const s = new PaddleOcrService(options);
    await s.initialize();
    return s;
  })());
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The parts of the library's detector and recogniser used here (see the header). */
interface Internals {
  detector: {
    preprocessDetection(canvas: OffscreenCanvas): Promise<{
      tensor: Float32Array;
      width: number;
      height: number;
      resizeRatio: number;
    }>;
    runInference(tensor: Float32Array, width: number, height: number): Promise<Float32Array | null>;
  };
  recognitor: {
    run(
      image: OffscreenCanvas,
      boxes: Box[],
      dictionary: undefined,
      strategy: "per-box",
      options: { rotateVerticalCrops: boolean },
    ): Promise<{ text: string; box: Box; confidence: number }[]>;
  };
}

function internals(s: PaddleOcrService): Internals {
  const x = s as unknown as Partial<Internals>;
  if (!x.detector?.preprocessDetection || !x.detector.runInference || !x.recognitor?.run) {
    throw new Error("ppu-paddle-ocr internals changed: detector/recogniser not found");
  }
  return x as Internals;
}

type Read = Omit<Extract<WorkerResponse, { ok: true }>, "ok" | "id" | "ms">;

async function read(image: ImageBitmap): Promise<Read> {
  const { detector, recognitor } = internals(await service());

  // The detector and the strips both read the frame from a canvas.
  const frame = new OffscreenCanvas(image.width, image.height);
  const frameCtx = frame.getContext("2d", { willReadFrequently: true });
  if (!frameCtx) throw new Error("no 2d canvas in the OCR worker");
  frameCtx.drawImage(image, 0, 0);
  image.close();

  const started = performance.now();
  const input = await detector.preprocessDetection(frame);
  const map = await detector.runInference(input.tensor, input.width, input.height);
  const detectMs = Math.round(performance.now() - started);
  const none: Read = { reads: [], blocks: 0, detectMs, reused: 0 };
  if (!map) return none;

  const lines = findLines(map, input.width, input.height, 1 / input.resizeRatio);
  if (!lines.length) {
    remembered = [];
    return none;
  }
  const split = splitBlocks(lines, frame.width);

  // Which lines look just like they did last frame: they keep their reading.
  const pixels = frameCtx.getImageData(0, 0, frame.width, frame.height).data;
  const signatures = lines.map((l) => lineSignature(pixels, frame.width, frame.height, l));
  const fresh = remembered.length === 0 || framesSinceFull >= FULL_READ_EVERY;
  const taken = new Set<number>();
  const kept = lines.map((l, i) => {
    if (fresh) return undefined;
    const j = matchLine(remembered, l, signatures[i] ?? new Float32Array(), taken);
    const r = remembered[j];
    if (!r || r.confidence < REUSE_MIN_CONFIDENCE) return undefined;
    taken.add(j);
    return r;
  });
  framesSinceFull = fresh ? 0 : framesSinceFull + 1;

  // Flatten the lines to read into level strips and stack them.
  const toRead = lines.filter((_, i) => !kept[i]);
  const text = new Map<TextLine, { text: string; confidence: number }>();
  if (toRead.length) {
    const plan = planStrips(toRead);
    const stack = new OffscreenCanvas(plan.width, plan.height);
    const ctx = stack.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas in the OCR worker");
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = NEUTRAL;
    ctx.fillRect(0, 0, plan.width, plan.height);
    for (const strip of plan.strips) {
      for (const seg of strip.segments) {
        const { x, y, w, h } = seg.source;
        ctx.save();
        ctx.beginPath();
        ctx.rect(seg.clip.x, seg.clip.y, seg.clip.w, seg.clip.h);
        ctx.clip();
        ctx.setTransform(...seg.matrix);
        ctx.drawImage(frame, x, y, w, h, x, y, w, h);
        ctx.restore();
      }
    }
    // Each strip read on its own; a strip is wide and flat, so never turn it upright.
    const results = await recognitor.run(
      stack,
      plan.strips.map((s) => s.box),
      undefined,
      "per-box",
      { rotateVerticalCrops: false },
    );
    const byTop = new Map(results.map((r) => [Math.round(r.box.y), r]));
    for (const strip of plan.strips) {
      const r = byTop.get(Math.round(strip.box.y));
      if (r) text.set(strip.line, { text: r.text, confidence: r.confidence });
    }
  }

  const reads: StripRead[] = [];
  const next: RememberedLine[] = [];
  lines.forEach((line, i) => {
    const old = kept[i];
    const got = old ? { text: old.text, confidence: old.confidence } : text.get(line);
    if (!got) return;
    reads.push({ line, text: got.text, confidence: got.confidence, block: split.block[i] ?? 0 });
    next.push({ line, signature: signatures[i] ?? new Float32Array(), ...got });
  });
  remembered = next;
  return {
    reads,
    blocks: new Set(split.block).size,
    detectMs,
    reused: kept.filter(Boolean).length,
  };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, image } = event.data;
  const started = performance.now();
  try {
    const result = await read(image);
    const response: WorkerResponse = {
      id,
      ok: true,
      ...result,
      ms: Math.round(performance.now() - started),
    };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
