// Voice input for the simulator, using the browser's Web Speech API (SpeechRecognition).
//
// Support: Chrome, Edge and Safari. Firefox has none, so the simulator panel also offers a typed
// command box. Privacy: Chrome and Edge send the audio to their vendor's speech service to
// transcribe it. Nothing is stored by us. This is a simulator stand-in only.
//
// On real glasses, voice goes glasses mic -> our app -> Gemini Live (build order step 7).
// OPEN QUESTION: "Hey Meta" wakes Meta AI, not third-party apps. Can a DAT app get a wake word
// at all, or only push-to-talk (touchpad hold / Neural Band)? Until confirmed, push-to-talk is
// the primary path and the wake phrase is a simulator-only option.

// TypeScript's DOM lib does not ship SpeechRecognition types; this is the subset we use.
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent {
  readonly error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;

function getRecognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const WAKE_PHRASE = "hey meta";

/** Lowercase, drop punctuation, collapse spaces. */
export function normaliseUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does `text` start with the wake phrase? Returns the command after it ("" if the wake phrase
 * was said on its own), or null if it was not addressed to the glasses.
 */
export function matchWakePhrase(text: string, phrase: string = WAKE_PHRASE): string | null {
  const said = normaliseUtterance(text);
  const wake = normaliseUtterance(phrase);
  if (said === wake) return "";
  if (said.startsWith(`${wake} `)) return said.slice(wake.length + 1);
  return null;
}

export type RecognitionFailure = "permission-denied" | "unsupported" | "network" | "unknown";

export class SpeechRecognizer {
  private wake: Recognition | null = null;
  private wakeWanted = false;
  /** After the wake phrase alone, the next utterance is the command. */
  private armedUntil = 0;

  static isSupported(): boolean {
    return getRecognitionConstructor() !== null;
  }

  private create(continuous: boolean): Recognition {
    const Ctor = getRecognitionConstructor();
    if (!Ctor) throw new Error("unsupported");
    const recognition = new Ctor();
    recognition.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
    recognition.continuous = continuous;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    return recognition;
  }

  /** Listen for one utterance. Resolves with the transcript ("" if nothing was heard). */
  listenOnce(): Promise<string> {
    const resumeWake = this.wakeWanted;
    this.pauseWake();
    return new Promise<string>((resolve, reject) => {
      let transcript = "";
      let failure: RecognitionFailure | null = null;
      const recognition = this.create(false);
      recognition.onresult = (event) => {
        transcript = event.results[0]?.[0]?.transcript ?? "";
      };
      recognition.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          failure = "permission-denied";
        } else if (event.error === "network") {
          failure = "network";
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          failure = "unknown";
        }
      };
      recognition.onend = () => {
        if (resumeWake) this.startWake(this.onWakeCommand);
        if (failure) reject(new Error(failure));
        else resolve(transcript.trim());
      };
      recognition.start();
    });
  }

  private onWakeCommand: (command: string) => void = () => {};

  /** Keep listening; call `onCommand` with whatever follows the wake phrase. */
  startWake(onCommand: (command: string) => void): void {
    this.onWakeCommand = onCommand;
    this.wakeWanted = true;
    if (this.wake) return;
    const recognition = this.create(true);
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result?.isFinal) continue;
        const text = result[0]?.transcript ?? "";
        const command = matchWakePhrase(text);
        if (command === "") {
          this.armedUntil = Date.now() + 6000;
        } else if (command !== null) {
          onCommand(command);
        } else if (Date.now() < this.armedUntil) {
          this.armedUntil = 0;
          onCommand(normaliseUtterance(text));
        }
      }
    };
    recognition.onerror = (event) => {
      // Permission refused: stop trying rather than loop.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.wakeWanted = false;
      }
    };
    recognition.onend = () => {
      this.wake = null;
      // Browsers end continuous recognition after a while; restart while still wanted.
      if (this.wakeWanted) this.startWake(this.onWakeCommand);
    };
    this.wake = recognition;
    try {
      recognition.start();
    } catch {
      this.wake = null;
    }
  }

  isWakeListening(): boolean {
    return this.wakeWanted;
  }

  /** Browsers allow one recognition at a time: push-to-talk pauses the wake listener. */
  private pauseWake(): void {
    this.stopWake();
  }

  stopWake(): void {
    this.wakeWanted = false;
    if (this.wake) {
      this.wake.onend = null;
      this.wake.abort();
      this.wake = null;
    }
  }
}
