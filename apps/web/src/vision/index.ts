// Vision runs in the browser on frames from GlassesAdapter.startCamera() (never the browser
// camera directly): OCR line boxes, hand tracking, hand poses and nearest-line picking.
export { classifyPose, type Hand, LM, type Point, type Pose } from "./handPose";
export {
  handsFeed,
  type HandsFeed,
  type HandsFrame,
  type HandTracker,
  MediaPipeHandTracker,
  type TrackedHand,
} from "./handTracking";
export { initialPickerState, pickLine, type PickerState } from "./linePicker";
export {
  type Baseline,
  type Box,
  normaliseLines,
  type OcrEngine,
  type OcrLine,
  type OcrResult,
  TesseractOcr,
} from "./ocr";
