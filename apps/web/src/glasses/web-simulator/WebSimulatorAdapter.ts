// The browser standing in for Meta glasses:
//   browser camera        -> glasses camera (aimed at the book page)
//   browser mic / speaker -> glasses mic / speakers
//   simulator panel       -> Ray-Ban Display (600x600, ~20 deg FOV, right lens)
//   keys + on-screen btns -> Neural Band gestures
//   audio-only toggle     -> Ray-Ban Meta Gen 2 (no display)
//
// This folder is the ONLY place allowed to use navigator.mediaDevices and browser audio APIs
// (enforced by ESLint).
import {
  type Cue,
  type Gesture,
  type GlassesAdapter,
  type GlassesCapabilities,
  GlassesError,
  RAY_BAN_DISPLAY_SIZE,
  type WordCard,
} from "../adapter";
import { makeImage, makePhrase, makeWordCard } from "../simulator-ui/displayModel";
import { createSimulatorStore, type SimulatorStore } from "../simulator-ui/simulatorStore";
import { keyToGesture } from "./gestures";
import { MIC_WORKLET_SOURCE, floatToInt16 } from "./micWorklet";

type KeyTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export interface WebSimulatorOptions {
  /** Where to listen for gesture keys. Defaults to `window`. */
  keyTarget?: KeyTarget;
}

// Short tones per cue: [frequency Hz, duration s] steps.
const CUE_TONES: Record<Cue, ReadonlyArray<[number, number]>> = {
  tick: [[880, 0.04]],
  ok: [
    [660, 0.07],
    [990, 0.09],
  ],
  "lost-hand": [
    [520, 0.1],
    [390, 0.14],
  ],
  error: [[220, 0.22]],
};

function cameraError(error: unknown): GlassesError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new GlassesError("permission-denied", "Camera permission was denied.", {
      cause: error,
    });
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new GlassesError("no-device", "No camera was found.", { cause: error });
  }
  return new GlassesError("unknown", "The camera could not start.", { cause: error });
}

function micError(error: unknown): GlassesError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new GlassesError("permission-denied", "Microphone permission was denied.", {
      cause: error,
    });
  }
  if (name === "NotFoundError") {
    return new GlassesError("no-device", "No microphone was found.", { cause: error });
  }
  return new GlassesError("unknown", "The microphone could not start.", { cause: error });
}

function assertMediaAvailable(): MediaDevices {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new GlassesError(
      "insecure-context",
      "Camera and microphone need a secure context (localhost or HTTPS).",
    );
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new GlassesError("unsupported", "This browser cannot access the camera or microphone.");
  }
  return navigator.mediaDevices;
}

export class WebSimulatorAdapter implements GlassesAdapter {
  readonly store: SimulatorStore = createSimulatorStore();

  private readonly keyTarget: KeyTarget | null;
  private readonly gestureHandlers = new Set<(g: Gesture) => void>();
  private keyListenerAttached = false;
  private readonly streams = new Set<MediaStream>();
  private cueContext: AudioContext | null = null;
  private mic: { context: AudioContext; node: AudioWorkletNode; url: string } | null = null;

  constructor(options: WebSimulatorOptions = {}) {
    this.keyTarget = options.keyTarget ?? (typeof window !== "undefined" ? window : null);
  }

  get capabilities(): GlassesCapabilities {
    const display = !this.store.getState().audioOnly;
    return {
      display,
      displaySize: display ? { ...RAY_BAN_DISPLAY_SIZE } : undefined,
      // Simulated by keys and on-screen buttons.
      neuralBand: true,
    };
  }

  // ---- Simulator-only controls (used by the simulator panel, not by the app) ----

  /** Audio-only mode simulates Ray-Ban Meta Gen 2: the display goes blank. */
  setAudioOnly(audioOnly: boolean): void {
    this.store.setState({ audioOnly });
  }

  /** On-screen gesture buttons call this, like a Neural Band gesture would. */
  emitGesture(gesture: Gesture): void {
    for (const handler of [...this.gestureHandlers]) handler(gesture);
  }

  // ---- Input ----

  async startCamera(): Promise<MediaStream> {
    const media = assertMediaAvailable();
    try {
      const stream = await media.getUserMedia({
        // Rear camera on phones, the only camera on laptops.
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      this.track(stream);
      return stream;
    } catch (error) {
      throw cameraError(error);
    }
  }

  async startMic(onAudio: (pcm: Int16Array) => void): Promise<void> {
    if (this.mic) throw new GlassesError("unknown", "The microphone is already running.");
    const media = assertMediaAvailable();
    let stream: MediaStream;
    try {
      stream = await media.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
    } catch (error) {
      throw micError(error);
    }
    this.track(stream);

    // OPEN QUESTION: Gemini Live's expected input format (16 kHz mono PCM16?). This emits mono
    // PCM16 at the AudioContext's native rate; resampling belongs to src/live/ (build step 7).
    const context = new AudioContext();
    const url = URL.createObjectURL(new Blob([MIC_WORKLET_SOURCE], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(context, "pcm-capture");
      node.port.onmessage = (event: MessageEvent<Float32Array>) =>
        onAudio(floatToInt16(event.data));
      context.createMediaStreamSource(stream).connect(node);
      this.mic = { context, node, url };
    } catch (error) {
      URL.revokeObjectURL(url);
      void context.close();
      this.untrack(stream);
      throw new GlassesError("unsupported", "Audio capture is not supported here.", {
        cause: error,
      });
    }
  }

  onGesture(handler: (g: Gesture) => void): () => void {
    this.gestureHandlers.add(handler);
    this.attachKeys();
    return () => {
      this.gestureHandlers.delete(handler);
      if (this.gestureHandlers.size === 0) this.detachKeys();
    };
  }

  // ---- Output ----
  // The simulated display keeps exactly one item; each call replaces it. In audio-only mode the
  // panel renders nothing, and the app is expected to use cues/speech instead.

  showPhrase(text: string, opts?: { emphasis?: [number, number] }): void {
    this.store.setState({ content: makePhrase(text, opts?.emphasis) });
  }

  showWordCard(card: WordCard): void {
    this.store.setState({ content: makeWordCard(card) });
  }

  showImage(url: string): void {
    this.store.setState({ content: makeImage(url) });
  }

  clearDisplay(): void {
    this.store.setState({ content: null });
  }

  speak(text: string): Promise<void> {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || !text.trim()) return Promise.resolve();
    // Newest request wins: read-along should not queue up stale phrases.
    synth.cancel();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => resolve();
      // A failed or cancelled utterance must never break the reading session.
      utterance.onerror = () => resolve();
      synth.speak(utterance);
    });
  }

  playCue(kind: Cue): void {
    this.store.setState({ lastCue: { kind, at: Date.now() } });
    if (typeof AudioContext === "undefined") return;
    try {
      this.cueContext ??= new AudioContext();
      const ctx = this.cueContext;
      void ctx.resume();
      let t = ctx.currentTime;
      for (const [frequency, duration] of CUE_TONES[kind]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + duration + 0.02);
        t += duration + 0.03;
      }
    } catch {
      // Cues are best-effort; the visual cue in the panel still shows.
    }
  }

  dispose(): void {
    this.gestureHandlers.clear();
    this.detachKeys();
    for (const stream of [...this.streams]) this.untrack(stream);
    if (this.mic) {
      this.mic.node.port.onmessage = null;
      this.mic.node.disconnect();
      void this.mic.context.close();
      URL.revokeObjectURL(this.mic.url);
      this.mic = null;
    }
    if (this.cueContext) {
      void this.cueContext.close();
      this.cueContext = null;
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    this.store.setState({ content: null });
  }

  // ---- Internals ----

  private readonly handleKey = (event: Event): void => {
    const gesture = keyToGesture(event as KeyboardEvent);
    if (!gesture) return;
    event.preventDefault();
    this.emitGesture(gesture);
  };

  private attachKeys(): void {
    if (this.keyListenerAttached || !this.keyTarget) return;
    this.keyTarget.addEventListener("keydown", this.handleKey);
    this.keyListenerAttached = true;
  }

  private detachKeys(): void {
    if (!this.keyListenerAttached || !this.keyTarget) return;
    this.keyTarget.removeEventListener("keydown", this.handleKey);
    this.keyListenerAttached = false;
  }

  private track(stream: MediaStream): void {
    this.streams.add(stream);
    // When the app stops the stream's tracks, forget it.
    for (const t of stream.getTracks()) {
      t.addEventListener("ended", () => {
        if (stream.getTracks().every((x) => x.readyState === "ended")) this.streams.delete(stream);
      });
    }
  }

  private untrack(stream: MediaStream): void {
    for (const t of stream.getTracks()) t.stop();
    this.streams.delete(stream);
  }
}
