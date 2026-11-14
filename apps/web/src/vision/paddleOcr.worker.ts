// PaddleOCR in a Web Worker, so recognition never blocks the camera view or hand tracking.
// Uses ppu-paddle-ocr (PaddleOCR PP-OCRv6 via ONNX Runtime Web; WebGPU when available, else
// WASM).
//
// Laptop-first: PP-OCRv6 small (31 MB, downloaded once). Chosen over tiny (6 MB) on synthetic
// 1280x720 pages with the same library and settings: on a webcam-like page (small, faint, noisy
// text) small read 95% of words vs 75%, and pointing picked the right word 59/65 vs 48/65;
// ~0.25 s per read vs ~0.1 s on a laptop CPU. v6 medium was no better and 4x slower.
//
// Two passes (word recall with small: clean / 3.5 deg tilt / perspective + glare / webcam):
//   1. fast: 100 / 5 / 89 / 95 %. Tilted pages fail, but the confidence shows it (0.51 on the
//      tilted page vs 0.96+ on good reads).
//   2. unwarp: if the fast pass is unsure, flatten the page first (UVDoc, ~30 MB, loaded on first
//      need): 100 / 100 / 100 / 94 %, ~1.3-1.8 s per read on a laptop CPU.
// HACK: models load from the library's model repos (GitHub / Hugging Face) on first use and are
// cached by the browser. Vendor them for an offline demo.
import { PaddleOcrService, type PaddleOcrResult, V6_SMALL_MODEL } from "ppu-paddle-ocr/web";

/**
 * Below this mean confidence the fast pass is retried with unwarping. Set from the measurements
 * above: 0.97 catches the tilted (0.51) and glare (0.956, 89% -> 100%) pages without flattening
 * clean ones (0.98-0.996). The live loop runs this pass at most every 10 s. [ASSUMPTION]
 */
const UNWARP_BELOW_CONFIDENCE = 0.97;

export interface WorkerRequest {
  id: number;
  /** A live video frame. */
  image: ImageBitmap;
  /** Allow the slow flattening pass if the quick read is unsure. */
  allowUnwarp: boolean;
}

export interface WorkerItem {
  text: string;
  box: { x: number; y: number; width: number; height: number };
  confidence: number;
}

export type WorkerResponse =
  | {
      id: number;
      ok: true;
      lines: WorkerItem[][];
      confidence: number;
      unwarped: boolean;
      /** The flattening pass ran (whether or not its read was kept). */
      unwarpTried: boolean;
      ms: number;
    }
  | { id: number; ok: false; error: string };

const options = {
  model: V6_SMALL_MODEL,
  // The web build has no OpenCV image processor; canvas-native is what runs in the browser
  // (an "opencv" setting silently falls back to it).
  processing: { engine: "canvas-native" as const },
};

let fast: Promise<PaddleOcrService> | null = null;
let unwarp: Promise<PaddleOcrService> | null = null;

function service(kind: "fast" | "unwarp"): Promise<PaddleOcrService> {
  const make = async (withUnwarp: boolean) => {
    const s = new PaddleOcrService({ ...options, unwarping: { enabled: withUnwarp } });
    await s.initialize();
    return s;
  };
  if (kind === "fast") return (fast ??= make(false));
  return (unwarp ??= make(true));
}

/** The library reads canvases directly; a frame is drawn once and reused for both passes. */
function toInput(image: ImageBitmap): () => OffscreenCanvas {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext("2d")?.drawImage(image, 0, 0);
  image.close();
  return () => canvas;
}

async function recognize(
  image: ImageBitmap,
  allowUnwarp: boolean,
): Promise<{ result: PaddleOcrResult; unwarped: boolean; unwarpTried: boolean }> {
  const input = toInput(image);
  const first = (await (
    await service("fast")
  ).recognize(input(), {
    noCache: true,
  })) as PaddleOcrResult;
  const sure = first.lines.length > 0 && first.confidence >= UNWARP_BELOW_CONFIDENCE;
  if (sure || !allowUnwarp) return { result: first, unwarped: false, unwarpTried: false };
  const second = (await (
    await service("unwarp")
  ).recognize(input(), {
    noCache: true,
  })) as PaddleOcrResult;
  // Keep whichever read is more confident.
  return second.confidence > first.confidence
    ? { result: second, unwarped: true, unwarpTried: true }
    : { result: first, unwarped: false, unwarpTried: true };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, image, allowUnwarp } = event.data;
  const started = performance.now();
  try {
    const { result, unwarped, unwarpTried } = await recognize(image, allowUnwarp);
    const response: WorkerResponse = {
      id,
      ok: true,
      lines: result.lines.map((line) =>
        line.map(({ text, box, confidence }) => ({ text, box, confidence })),
      ),
      confidence: result.confidence,
      unwarped,
      unwarpTried,
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
