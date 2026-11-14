// GlassesAdapter: the only way the app talks to "the glasses".
//
// Today the browser stands in for the glasses (WebSimulatorAdapter). Later a MetaDatAdapter
// talks to real Meta glasses through the Wearables Device Access Toolkit. The rest of the app
// must only use this interface, never browser camera/audio/speech APIs directly (enforced by
// ESLint: those APIs are only allowed in src/glasses/web-simulator/).
//
// Hardware inputs (Neural Band, temple touchpad, capture button) are translated by the adapter
// into the app-level intents below, so the app never depends on which device sent them.

/**
 * App-level intents from the glasses' hardware inputs.
 * - next / prev: move through phrases
 * - select: open the word card for the current phrase
 * - dismiss: back / close
 * - play-pause: read the current phrase aloud, or stop reading
 * - capture: take a photo of the page
 * - assistant: start listening for a voice command (push-to-talk)
 */
export type Gesture =
  "next" | "prev" | "select" | "dismiss" | "play-pause" | "capture" | "assistant";

export type Cue = "tick" | "ok" | "lost-hand" | "error" | "shutter" | "listening";

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
  /** Voice commands can be recognised (see listen()). */
  voice: boolean;
}

/** Physical state of the glasses. Changes come from the device, not the app. */
export interface GlassesState {
  connected: boolean;
  /** On the user's face. When false, the app should pause reading. */
  worn: boolean;
  /** Arms folded: the camera stops and the display is off. */
  folded: boolean;
  /** 0-100. */
  battery: number;
  /** Speaker volume 0-1, changed on the device (touchpad swipe / Neural Band twist). */
  volume: number;
  /** The camera is in use; the privacy LED on the frame is lit. */
  cameraActive: boolean;
}

export interface GlassesAdapter {
  /** Current capabilities. Can change while running (e.g. the simulator's audio-only toggle). */
  readonly capabilities: GlassesCapabilities;
  /** Current device state. */
  readonly state: GlassesState;
  /** Returns an unsubscribe function. */
  onStateChange(handler: (state: GlassesState) => void): () => void;

  // Input from the glasses
  /** Book page frames (point-of-view camera). Stops when the glasses are folded. */
  startCamera(): Promise<MediaStream>;
  /** Stop the camera (the privacy LED goes off). */
  stopCamera(): void;
  /** A still photo of the page from the running camera (capture button). Not saved anywhere. */
  capturePhoto(): Promise<Blob>;
  startMic(onAudio: (pcm: Int16Array) => void): Promise<void>;
  /** Returns an unsubscribe function. */
  onGesture(handler: (g: Gesture) => void): () => void;
  /** Listen for one voice command (push-to-talk). Resolves with the transcript, "" if none. */
  listen(): Promise<string>;
  /** Voice commands heard without push-to-talk (e.g. after a wake phrase). Unsubscribe fn. */
  onUtterance(handler: (text: string) => void): () => void;

  // Output to the glasses
  /** `emphasis` is a [start, end) character range of `text` to highlight. */
  showPhrase(text: string, opts?: { emphasis?: [number, number] }): void;
  showWordCard(card: WordCard): void;
  /** Only if capabilities.display. */
  showImage(url: string): void;
  /** Live camera view on the display, to line up the page. Needs a running camera. */
  showViewfinder(): void;
  clearDisplay(): void;
  /** Read-along and answers. Resolves when speech finishes or is stopped. */
  speak(text: string): Promise<void>;
  /** Stop any speech in progress. */
  stopSpeaking(): void;
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
  | "camera-off"
  | "glasses-unavailable"
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
