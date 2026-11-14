// "Hey Meta": the phrase that starts a question, like on the real glasses. Listening for it uses
// the browser's own speech recognition, so the always-on listening costs nothing and sends nothing
// to ElevenLabs: ElevenLabs only hears a recording that starts AFTER this phrase was heard.
//
// PRIVACY: in Chrome and Edge the browser's speech recognition sends its audio to the browser
// vendor's service to be recognised (it is not on-device), and it stops listening when you switch
// it off. It is off until you turn it on. Brave blocks the service (so "Hey Meta" cannot work
// there); Safari has its own.
// [ASSUMPTION] A real wake-word engine (on-device, e.g. Porcupine) would be better for always-on
// listening; the browser's recogniser is what is free and available.

/** The wake phrase, tolerant of how speech recognisers mishear it. */
const WAKE = /\b(?:hey|hay|hi|ok(?:ay)?)[\s,.!]*(?:meta|metta|meda|metter|mehta)\b/i;

/** Does what was heard contain "Hey Meta"? */
export function matchesWakePhrase(heard: string): boolean {
  return WAKE.test(heard.replace(/\s+/g, " ").trim());
}

/** The part of a browser SpeechRecognition used here (the API is prefixed and untyped in lib.dom). */
interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function wakeWordSupported(): boolean {
  return recognitionCtor() !== null;
}

export type WakeProblem = "unsupported" | "denied" | "unavailable";

/** What the listener is doing, for showing on the button. */
export type WakeState = "listening" | "retrying";

/** Wait this long (ms) before the next attempt after a failure: it backs off, then stays at the cap. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 10_000] as const;
/** Give up (and say why) after this many attempts in a row that never really listened. */
export const MAX_FAILURES = 6;
/** A session that lasted this long counts as working, and clears the failure count. */
export const HEALTHY_MS = 3000;

/**
 * Listens for the wake phrase until stopped. The browser ends a session every so often (silence,
 * a timer) and its speech service can fail for a moment (network, the microphone briefly busy):
 * none of that should switch listening off, so it starts again, backing off when it keeps
 * failing. Only things that cannot get better (the microphone is blocked, the service is refused,
 * or it has failed over and over) stop it, and then `onProblem` says why.
 */
export class WakeWordListener {
  private recognition: RecognitionLike | null = null;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private startedAt = 0;
  private lastError = "";

  constructor(
    private readonly onWake: () => void,
    private readonly onProblem: (problem: WakeProblem, detail: string) => void,
    private readonly lang: () => string = () => "en-US",
    private readonly onState: (state: WakeState) => void = () => {},
  ) {}

  start(): void {
    if (this.active) return;
    if (!recognitionCtor()) {
      this.onProblem("unsupported", "no speech recognition in this browser");
      return;
    }
    this.active = true;
    this.failures = 0;
    this.listen();
  }

  private listen(): void {
    const Ctor = recognitionCtor();
    if (!this.active || !Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true; // act on the phrase as soon as it is heard, not after a pause
    rec.lang = this.lang();
    rec.onstart = () => {
      this.startedAt = Date.now();
      this.onState("listening");
    };
    rec.onresult = (event) => {
      this.failures = 0; // it is hearing: working
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const alternative = event.results[i]?.[0];
        if (alternative && matchesWakePhrase(alternative.transcript)) {
          this.stop(); // let go of the microphone: the question is recorded next
          this.onWake();
          return;
        }
      }
    };
    rec.onerror = (event) => {
      this.lastError = event.error;
      // These cannot get better by trying again.
      if (event.error === "not-allowed") this.giveUp("denied");
      else if (event.error === "service-not-allowed") this.giveUp("unavailable");
      // Anything else ("network", "audio-capture", "no-speech"...) is temporary: onend follows.
    };
    rec.onend = () => {
      if (!this.active) return;
      // A session that ran a while was fine (the browser just ends them); a quick end was not.
      if (this.startedAt && Date.now() - this.startedAt >= HEALTHY_MS) this.failures = 0;
      else this.failures += 1;
      this.startedAt = 0;
      this.scheduleRestart();
    };
    this.recognition = rec;
    try {
      rec.start();
    } catch (error) {
      // "already started" races and the like: count it and try again, do not switch off.
      this.lastError = error instanceof Error ? error.name : "start-failed";
      this.failures += 1;
      this.scheduleRestart();
    }
  }

  private scheduleRestart(): void {
    if (this.failures >= MAX_FAILURES) {
      this.giveUp("unavailable");
      return;
    }
    const retrying = this.failures > 0;
    if (retrying) this.onState("retrying");
    const delay = retrying
      ? (RETRY_DELAYS_MS[Math.min(this.failures - 1, RETRY_DELAYS_MS.length - 1)] ?? 10_000)
      : 300;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.listen(), delay);
  }

  private giveUp(problem: WakeProblem): void {
    const detail = this.lastError || problem;
    this.stop();
    this.onProblem(problem, detail);
  }

  stop(): void {
    this.active = false;
    clearTimeout(this.timer);
    const rec = this.recognition;
    this.recognition = null;
    if (rec) {
      rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
      try {
        rec.abort();
      } catch {
        // Already stopped.
      }
    }
  }
}
