// Vision runs in the browser: hand tracking, OCR and nearest-line picking.
// Placeholders only (build order steps 3-4). Frames come from GlassesAdapter.startCamera(),
// never from the browser camera directly.
export type { HandTracker, Fingertip } from "./handTracking";
export type { OcrEngine, OcrLine } from "./ocr";
export type { LinePicker } from "./linePicker";
