// PaddleOCR in a Web Worker, so recognition never blocks the camera view or hand tracking.
// Uses ppu-paddle-ocr (PaddleOCR PP-OCRv6 via ONNX Runtime Web; WebGPU when available, else
// WASM).
//
// Two passes. Measured with the same library and settings on synthetic 1280x720 page photos
// (word recall: clean / 3.5 deg tilt / perspective + glare):
//   1. fast: PP-OCRv6 tiny, ~0.1 s on a laptop CPU: 100 / 6 / 97 %. Tilted pages fail, but the
//      confidence shows it (0.61 on the tilted page vs 0.97+ on good reads).
//   2. unwarp: if the fast pass is unsure, flatten the page first: 100 / 97 / 100 %, ~2 s on a
//      laptop CPU (slower on phones), plus a ~30 MB model loaded on first need.
// HACK: models load from the library's model repos (GitHub / Hugging Face) on first use and are
// cached by the browser. Vendor them for an offline demo.
import { PaddleOcrService, type PaddleOcrResult, V6_TINY_MODEL } from "ppu-paddle-ocr/web";

/** Below this mean confidence the fast pass is retried with unwarping. [ASSUMPTION] */
const UNWARP_BELOW_CONFIDENCE = 0.85;

export interface WorkerRequest {
  id: number;
  image: ArrayBuffer;
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
      ms: number;
    }
  | { id: number; ok: false; error: string };

const options = {
  model: V6_TINY_MODEL,
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

async function recognize(
  image: ArrayBuffer,
): Promise<{ result: PaddleOcrResult; unwarped: boolean }> {
  // The library may transfer or consume the buffer; keep a copy for the second pass.
  const copy = image.slice(0);
  const first = (await (
    await service("fast")
  ).recognize(image, { noCache: true })) as PaddleOcrResult;
  if (first.lines.length > 0 && first.confidence >= UNWARP_BELOW_CONFIDENCE) {
    return { result: first, unwarped: false };
  }
  const second = (await (
    await service("unwarp")
  ).recognize(copy, {
    noCache: true,
  })) as PaddleOcrResult;
  // Keep whichever read is more confident.
  return second.confidence > first.confidence
    ? { result: second, unwarped: true }
    : { result: first, unwarped: false };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, image } = event.data;
  const started = performance.now();
  try {
    const { result, unwarped } = await recognize(image);
    const response: WorkerResponse = {
      id,
      ok: true,
      lines: result.lines.map((line) =>
        line.map(({ text, box, confidence }) => ({ text, box, confidence })),
      ),
      confidence: result.confidence,
      unwarped,
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
