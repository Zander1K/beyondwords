// Vision runs in the browser on frames from GlassesAdapter.startCamera() (never the browser
// camera directly): OCR line boxes, hand tracking and nearest-line picking.
export type { HandTracker, Fingertip } from "./handTracking";
export {
  type Baseline,
  type Box,
  normaliseLines,
  type OcrEngine,
  type OcrLine,
  type OcrResult,
  TesseractOcr,
} from "./ocr";
export type { LinePicker } from "./linePicker";
