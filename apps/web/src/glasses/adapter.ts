// GlassesAdapter: the only way the app talks to "the glasses".
//
// Today the browser stands in for the glasses (WebSimulatorAdapter). Later a MetaDatAdapter
// talks to real Meta glasses through the Wearables Device Access Toolkit. The rest of the app
// must only use this interface, never browser camera/audio APIs directly (enforced by ESLint:
// those APIs are only allowed in src/glasses/web-simulator/).

export type Gesture = "next" | "prev" | "select" | "dismiss";

export type Cue = "tick" | "ok" | "lost-hand" | "error";

export interface WordCard {
  word: string;
  /** Short definition. The display shows one short line, not a paragraph. */
  short: string;
}

export interface GlassesCapabilities {
  /** Ray-Ban Display: true. Ray-Ban Meta Gen 2 (audio-only): false. */
  display: boolean;
  /** Ray-Ban Display: 600x600. */
  displaySize?: { w: number; h: number };
  neuralBand: boolean;
}

export interface GlassesAdapter {
  /** Current capabilities. Can change while running (e.g. the simulator's audio-only toggle). */
  readonly capabilities: GlassesCapabilities;

  // Input from the glasses
  /** Book page frames. */
  startCamera(): Promise<MediaStream>;
  startMic(onAudio: (pcm: Int16Array) => void): Promise<void>;
  /** Returns an unsubscribe function. */
  onGesture(handler: (g: Gesture) => void): () => void;

  // Output to the glasses
  /** `emphasis` is a [start, end) character range of `text` to highlight. */
  showPhrase(text: string, opts?: { emphasis?: [number, number] }): void;
  showWordCard(card: WordCard): void;
  /** Only if capabilities.display. */
  showImage(url: string): void;
  clearDisplay(): void;
  /** Read-along and answers. Resolves when speech finishes. */
  speak(text: string): Promise<void>;
  /** Audio cues, mainly for the no-display Gen 2. */
  playCue(kind: Cue): void;

  dispose(): void;
}

/** Why a glasses input could not start. Lets the UI show a friendly message. */
export type GlassesErrorCode =
  | "permission-denied"
  | "no-device"
  | "insecure-context"
  | "unsupported"
  | "not-implemented"
  | "unknown";

export class GlassesError extends Error {
  readonly code: GlassesErrorCode;

  constructor(code: GlassesErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GlassesError";
    this.code = code;
  }
}

/** Ray-Ban Display panel size in pixels (CLAUDE.md section 7). */
export const RAY_BAN_DISPLAY_SIZE = { w: 600, h: 600 } as const;
