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

/**
 * `reading`, `no-word` and `load-failed` are additions to the section 6 interface: the display
 * needs to say what is wrong (page being read, nothing pointed at, something did not load).
 */
export type StatusKind =
  | "listening"
  | "thinking"
  | "reading"
  | "hand-lost"
  | "offline"
  | "reconnecting"
  | "no-page"
  | "no-word"
  | "load-failed";

export type Cue = "tick" | "ok" | "lost-hand" | "error";

export type WordCardAction = "hear" | "picture";

/**
 * Why a word card has no definition (addition to the section 6 interface): the word is not in
 * the dictionary / could not be read, or the lookup did not load.
 */
export type WordCardProblem = "not-found" | "load-failed";

export interface WordCard {
  word: string;
  /**
   * How to say it: a respelling with the stressed syllable in capitals ("uh-LOOF"), or the
   * syllables joined with dots when the brain gave none. Shown between the word and its
   * definition. Optional: older cards and failures have none.
   */
  pronunciation?: string;
  /** Short definition, one or two lines. May be empty when `problem` is set. */
  short: string;
  /** The brain says this word can be drawn, so an illustration may follow the definition. */
  illustratable?: boolean;
  /** An illustration of the word, shown under the definition once it has been made. */
  imageUrl?: string;
  /** A picture is being generated: the card shows a loading placeholder where it will appear. */
  imageLoading?: boolean;
  /** The card shows what went wrong instead of a definition. */
  problem?: WordCardProblem;
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
