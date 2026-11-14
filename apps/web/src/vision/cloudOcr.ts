// Reads text with Google Cloud Vision, through our API (the key stays on the server).
//
// PRIVACY: unlike the on-device reader, this SENDS camera frames to Google (through our server) to
// be read. Nothing is stored by us. The Controls sheet says so, and it can be switched off.
//
// It implements OcrEngine so the live reader does not care which one reads the page. To keep it
// cheap and fast it does not read every frame: see cloudPolicy.ts. It never closes the frame it
// is given (the caller does, or hands it to the on-device reader if this one fails).
import { API_BASE_URL } from "@/config";

import { changedShare, CLOUD_POLICY, CloudGate } from "./cloudPolicy";
import type { OcrEngine, OcrResult } from "./ocr";

/** The long side of the image sent: Vision reads small print well at about this size. */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.82;
/** The little picture used to tell whether the scene changed. */
const THUMB_W = 32;
const THUMB_H = 24;

export class CloudOcrError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CloudOcrError";
    this.status = status;
  }
}

interface ServerPage {
  lines: OcrResult["lines"];
  blocks: number;
  ms: number;
}

/** Whether Google Vision is set up on the server (GET /ocr/status). Never throws. */
export async function cloudOcrAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE_URL}/ocr/status`, { signal });
    return r.ok && ((await r.json()) as { available?: boolean }).available === true;
  } catch {
    return false;
  }
}

function thumbnail(frame: ImageBitmap): Uint8Array {
  const canvas = new OffscreenCanvas(THUMB_W, THUMB_H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new Uint8Array(0);
  ctx.drawImage(frame, 0, 0, THUMB_W, THUMB_H);
  const rgba = ctx.getImageData(0, 0, THUMB_W, THUMB_H).data;
  const gray = new Uint8Array(THUMB_W * THUMB_H);
  for (let i = 0; i < gray.length; i++) {
    gray[i] =
      0.299 * (rgba[i * 4] ?? 0) + 0.587 * (rgba[i * 4 + 1] ?? 0) + 0.114 * (rgba[i * 4 + 2] ?? 0);
  }
  return gray;
}

async function encode(frame: ImageBitmap): Promise<Blob> {
  const scale = Math.min(1, MAX_SIDE / Math.max(frame.width, frame.height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(frame.width * scale)),
    Math.max(1, Math.round(frame.height * scale)),
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new CloudOcrError(0, "no 2d canvas");
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
}

export class CloudOcr implements OcrEngine {
  private readonly gate = new CloudGate();
  private last: OcrResult | null = null;
  private lastThumb: Uint8Array | null = null;

  async recognizeFrame(frame: ImageBitmap): Promise<OcrResult> {
    const thumb = thumbnail(frame);
    const changed = this.lastThumb
      ? changedShare(this.lastThumb, thumb) >= CLOUD_POLICY.changedShare
      : null;
    const now = performance.now();
    if (this.last && this.gate.decide(now, changed) === "reuse") {
      return { ...this.last, reused: this.last.lines.length, ms: 0 };
    }

    const started = performance.now();
    const response = await fetch(`${API_BASE_URL}/ocr/page`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: await encode(frame),
    });
    if (!response.ok) {
      throw new CloudOcrError(response.status, `POST /ocr/page failed with ${response.status}`);
    }
    const page = (await response.json()) as ServerPage;
    this.gate.record(now);
    this.lastThumb = thumb;
    this.last = {
      lines: page.lines,
      width: frame.width,
      height: frame.height,
      ms: Math.round(performance.now() - started),
      detectMs: page.ms,
      reused: 0,
      blocks: page.blocks,
    };
    return this.last;
  }

  dispose(): void {
    this.last = null;
    this.lastThumb = null;
  }
}
