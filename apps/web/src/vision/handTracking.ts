// Hand tracking: find the reading fingertip in a camera frame.
// TODO(alex): build order step 4. Intended: MediaPipe HandLandmarker from @mediapipe/tasks-vision
// (VIDEO running mode, 1 hand, index fingertip = landmark 8). Not installed yet; add it with the
// implementation. Must keep the highlight update under ~150 ms (CLAUDE.md section 8).

/** Fingertip position in the frame, normalised 0-1 (top-left origin). */
export interface Fingertip {
  x: number;
  y: number;
  /** Tracker confidence 0-1. */
  score: number;
}

export interface HandTracker {
  /** Load the model. Call once before detect(). */
  init(): Promise<void>;
  /** Fingertip in this frame, or null if no hand (caller keeps the last line: CLAUDE.md 9). */
  detect(frame: TexImageSource, timestampMs: number): Fingertip | null;
  dispose(): void;
}
