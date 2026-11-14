// OCR: text lines and their boxes from a page frame.
// TODO(alex): build order step 3. Intended default: Tesseract.js running in a Web Worker so the
// UI thread stays free. Not installed yet; add it with the implementation.
// OPEN QUESTION: line boxes in pixels or normalised 0-1? (docs/OPEN_QUESTIONS.md #3)

export interface OcrLine {
  text: string;
  /** Bounding box. Units: see OPEN QUESTION above. */
  box: { x: number; y: number; w: number; h: number };
  confidence: number;
}

export interface OcrEngine {
  init(): Promise<void>;
  recognize(frame: ImageBitmap | HTMLCanvasElement): Promise<OcrLine[]>;
  dispose(): Promise<void>;
}
