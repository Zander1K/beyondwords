// Nearest-line picking: which OCR line the fingertip is under.
// TODO(alex): build order step 4. Pick the line whose box is just above the fingertip; keep the
// last line when tracking is lost (CLAUDE.md section 9).
import type { Fingertip } from "./handTracking";
import type { OcrLine } from "./ocr";

export interface LinePicker {
  /** Index into `lines`, or null if no line is close enough. */
  pick(lines: readonly OcrLine[], fingertip: Fingertip): number | null;
}
