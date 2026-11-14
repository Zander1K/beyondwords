// Vision runs in the browser on frames from GlassesAdapter.startCamera() (never the browser
// camera directly): OCR line boxes, hand tracking, hand poses and nearest-line picking.
export {
  classifyPose,
  type Hand,
  type Hand3,
  isPointing,
  LM,
  type Point,
  type Pose,
} from "./handPose";
export {
  handsFeed,
  type HandsFeed,
  type HandsFrame,
  type HandTracker,
  MediaPipeHandTracker,
  type TrackedHand,
} from "./handTracking";
export { FingerDetector } from "./fingerDetector";
export { HOLD_TUNING, HoldDetector, type HoldState } from "./hold";
export { type FingerTip, findFingertip, SkinModel, skinMask } from "./fingertip";
export { OneEuroFilter, PointFilter } from "./oneEuro";
export {
  initialPickerState,
  MOUSE_THRESHOLDS,
  pickLine,
  type PickerState,
  wordAt,
} from "./linePicker";
export {
  type Baseline,
  type Box,
  type OcrEngine,
  type OcrLine,
  type OcrResult,
  type OcrWord,
  PaddleOcr,
  stripReadsToLines,
  type StripRead,
} from "./ocr";
export { CloudOcr, CloudOcrError, cloudOcrAvailable } from "./cloudOcr";
