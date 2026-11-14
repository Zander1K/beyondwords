// GlassesAdapter: the only way the app talks to "the glasses". Interface from
// SIMULATION_FEATURES.md section 6 (replaces the TASK.md version).
//
// Today the browser stands in for the glasses (WebSimulatorAdapter). Later a MetaDatAdapter
// talks to real Meta glasses through the Wearables Device Access Toolkit. The rest of the app
// must only use this interface, never browser camera/audio APIs directly (enforced by ESLint:
// those APIs are only allowed in src/glasses/web-simulator/).

/**
 * Six abstract input actions from the Neural Band and the frame touchpad.
 * OPEN QUESTION: the exact action events a third-party app receives are not documented
 * (SIMULATION_FEATURES.md section 9, question 1). `rotate` is P2 and not built.
 */
export type GlassesGesture = "select" | "back" | "left" | "right" | "up" | "down";

/** Display session lifecycle: stopped -> starting -> started -> stopping -> stopped. */
export type SessionState = "stopped" | "starting" | "started" | "stopping";

export type SessionEvent =
  "interrupted" | "resumed" | "slept" | "woke" | "disconnected" | "reconnected";

export type StatusKind =
  "listening" | "thinking" | "hand-lost" | "offline" | "reconnecting" | "no-page";

export type Cue = "tick" | "ok" | "lost-hand" | "error";

export type WordCardAction = "hear" | "picture";

export interface WordCard {
  word: string;
  /** Short definition, one or two lines. */
  short: string;
  actions?: WordCardAction[];
  /**
   * Which action button is highlighted. Addition to the section 6 interface.
   * OPEN QUESTION: whether the real display moves focus between buttons itself or the app
   * re-renders the card with a new focus (assumed here: the app re-renders).
   */
  focused?: WordCardAction;
}

export interface GlassesCapabilities {
  /** false in Gen 2 / audio-only mode. */
  display: boolean;
  displaySize?: { w: 600; h: 600 };
  neuralBand: boolean;
  touchpad: boolean;
}

export interface GlassesSession {
  readonly state: SessionState;
  /** User-initiated. Resolves once the session is `started`. */
  start(): Promise<void>;
  /** Resolves once the session is `stopped`. */
  stop(): Promise<void>;
}

export interface GlassesAdapter {
  readonly capabilities: GlassesCapabilities;

  // Session lifecycle
  readonly session: GlassesSession;
  /** Returns an unsubscribe function. */
  onSessionEvent(handler: (e: SessionEvent) => void): () => void;

  // Input from the glasses
  /** Live first-person camera. The caller stops the returned stream's tracks when done. */
  startCamera(): Promise<MediaStream>;
  /** A high-quality still from the running camera, for page analysis. */
  captureStill(): Promise<Blob>;
  startMic(onAudio: (pcm: Int16Array) => void): Promise<void>;
  stopMic(): void;
  /** Returns an unsubscribe function. */
  onGesture(handler: (g: GlassesGesture) => void): () => void;

  // Output to the glasses. Each call replaces the whole display scene. Ignored (and logged)
  // unless the session is `started`.
  /** `emphasis` is a [start, end) character range of `text` to highlight. */
  showPhrase(text: string, opts?: { emphasis?: [number, number] }): void;
  showWordCard(card: WordCard): void;
  /** Only if capabilities.display. */
  showImage(url: string): void;
  /** Small status icon shown alongside the current item; null hides it. */
  showStatus(kind: StatusKind | null): void;
  clearDisplay(): void;
  speak(text: string): Promise<void>;
  stopSpeaking(): void;
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
  | "session-inactive"
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

/** Ray-Ban Display panel size in pixels. [VERIFIED] SIMULATION_FEATURES.md section 2.3. */
export const RAY_BAN_DISPLAY_SIZE = { w: 600, h: 600 } as const;
