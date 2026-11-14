// The browser standing in for Meta glasses + Meta Neural Band (SIMULATION_FEATURES.md):
//   browser camera        -> first-person glasses camera (live view, stills)
//   browser mic / speaker -> glasses mic / open-ear speakers
//   simulator panel       -> Ray-Ban Display (600x600, right lens)
//   keys + pad buttons    -> six abstract actions from the Neural Band / touchpad
//   control strip         -> session lifecycle, audio-only (Gen 2) mode
//
// This folder is the ONLY place allowed to use navigator.mediaDevices and browser audio APIs
// (enforced by ESLint).
import {
  type Cue,
  type GlassesAdapter,
  type GlassesCapabilities,
  GlassesError,
  type GlassesGesture,
  type GlassesSession,
  RAY_BAN_DISPLAY_SIZE,
  type SessionEvent,
  type SessionState,
  type StatusKind,
  type WordCard,
} from "../adapter";
import {
  type DisplayContent,
  makeImage,
  makePhrase,
  makeWordCard,
} from "../simulator-ui/displayModel";
import { buildScene } from "../simulator-ui/scene";
import {
  createSimulatorStore,
  GESTURE_LOG_SIZE,
  type GestureLogEntry,
  type SimulatorStore,
} from "../simulator-ui/simulatorStore";
import type { HandsFeed } from "@/vision/handTracking";

import { CameraGestureRecognizer } from "./cameraGestures";
import { keyToGesture } from "./gestures";
import { MIC_WORKLET_SOURCE, floatToInt16 } from "./micWorklet";

type KeyTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export interface WebSimulatorOptions {
  /** Where to listen for gesture keys. Defaults to `window`. */
  keyTarget?: KeyTarget;
  /** Simulated session start/stop time. [ASSUMPTION] SIM-SES-02 says 1-2 s. */
  startDelayMs?: number;
  stopDelayMs?: number;
  /** Log ignored calls etc. Defaults to console.warn. */
  warn?: (message: string) => void;
  /** No-input time before the display dims (SIM-SES-04, default 30 s, tunable). */
  sleepTimeoutMs?: number;
}

/** Dim phase before the display blanks. [ASSUMPTION] Meta documents "dims then sleeps", no time. */
export const DIM_BEFORE_SLEEP_MS = 3000;
/** Simulated time to re-establish the link on Reconnect. [ASSUMPTION] */
const RECONNECT_DELAY_MS = 800;

// Short, distinct, quiet tones per cue: [frequency Hz, duration s] steps.
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
const CUE_GAIN = 0.15;

function mediaError(error: unknown, what: "Camera" | "Microphone"): GlassesError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new GlassesError("permission-denied", `${what} permission was denied.`, {
      cause: error,
    });
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new GlassesError("no-device", `No ${what.toLowerCase()} was found.`, { cause: error });
  }
  if (name === "NotReadableError") {
    return new GlassesError("no-device", `The ${what.toLowerCase()} is in use by another app.`, {
      cause: error,
    });
  }
  return new GlassesError("unknown", `The ${what.toLowerCase()} could not start.`, {
    cause: error,
  });
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

const CAMERA_SOURCE: Record<GlassesGesture, string> = {
  select: "index pinch",
  back: "middle pinch",
  left: "palm swipe",
  right: "palm swipe",
  up: "palm swipe",
  down: "palm swipe",
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class WebSimulatorAdapter implements GlassesAdapter {
  readonly store: SimulatorStore = createSimulatorStore();
  readonly session: GlassesSession;

  protected readonly warn: (message: string) => void;
  private readonly keyTarget: KeyTarget | null;
  private readonly startDelayMs: number;
  private readonly stopDelayMs: number;
  private readonly gestureHandlers = new Set<(g: GlassesGesture) => void>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt = Number.NEGATIVE_INFINITY;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  /** Session was running when the link dropped, so Reconnect restarts it. */
  private restartOnReconnect = false;
  private readonly sessionHandlers = new Set<(e: SessionEvent) => void>();
  private keyListenerAttached = false;
  private readonly streams = new Set<MediaStream>();
  private camera: MediaStream | null = null;
  private cueContext: AudioContext | null = null;
  private mic: {
    stream: MediaStream;
    context: AudioContext;
    node: AudioWorkletNode;
    url: string;
  } | null = null;

  constructor(options: WebSimulatorOptions = {}) {
    this.keyTarget = options.keyTarget ?? (typeof window !== "undefined" ? window : null);
    this.startDelayMs = options.startDelayMs ?? 1200;
    this.stopDelayMs = options.stopDelayMs ?? 300;
    const log = options.warn ?? ((m: string) => console.warn(`[glasses] ${m}`));
    this.warn = (message) => {
      log(message);
      const warnings = [{ message, at: Date.now() }, ...this.store.getState().warnings];
      this.store.setState({ warnings: warnings.slice(0, 8) });
    };
    if (options.sleepTimeoutMs !== undefined) {
      this.store.setState({ sleepTimeoutMs: options.sleepTimeoutMs });
    }
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const adapter = this;
    this.session = {
      get state() {
        return adapter.store.getState().session;
      },
      start: () => this.startSession(),
      stop: () => this.stopSession(),
    };
  }

  get capabilities(): GlassesCapabilities {
    const display = !this.store.getState().audioOnly;
    return {
      display,
      displaySize: display ? { ...RAY_BAN_DISPLAY_SIZE } : undefined,
      // Simulated by the gesture pad and keys.
      neuralBand: true,
      touchpad: true,
    };
  }

  // ---- Session lifecycle ----

  protected setSession(state: SessionState): void {
    this.store.setState({ session: state });
  }

  protected emitSession(event: SessionEvent): void {
    for (const handler of [...this.sessionHandlers]) handler(event);
  }

  private async startSession(): Promise<void> {
    if (!this.store.getState().connected) {
      throw new GlassesError("session-inactive", "The glasses are not connected.");
    }
    const state = this.session.state;
    if (state === "started" || state === "starting") return;
    this.store.setState({ interrupted: false });
    this.setSession("starting");
    await wait(this.startDelayMs);
    // Stopped while starting (e.g. dispose or disconnect): stay stopped.
    if (this.session.state !== "starting") return;
    this.setSession("started");
    this.wakeDisplay();
  }

  private async stopSession(): Promise<void> {
    const state = this.session.state;
    if (state === "stopped" || state === "stopping") return;
    this.setSession("stopping");
    this.endDisplay();
    await wait(this.stopDelayMs);
    this.setSession("stopped");
  }

  /** Clear the display and its timers; the glasses keep no app state. */
  private endDisplay(): void {
    this.clearSleepTimers();
    this.cancelFlush();
    this.store.setState({ item: null, status: null, scene: null, sleep: "awake" });
    this.stopSpeaking();
  }

  // ---- Simulated system events (control strip) ----

  /** SIM-SES-03: an incoming call or notification takes the display. Audio ducks (stops). */
  async interrupt(): Promise<void> {
    if (this.session.state !== "started") return;
    this.store.setState({ interrupted: true });
    this.setSession("stopping");
    // HACK: speechSynthesis cannot lower volume mid-utterance, so "ducking" stops speech.
    this.endDisplay();
    this.emitSession("interrupted");
    await wait(this.stopDelayMs);
    this.setSession("stopped");
  }

  /** SIM-SES-03: the interruption ends; the session comes back and the app restores itself. */
  async resume(): Promise<void> {
    if (!this.store.getState().interrupted) return;
    await this.startSession();
    if (this.session.state === "started") this.emitSession("resumed");
  }

  /** SIM-SES-04: the system sleep/wake gesture (double tap middle finger on thumb). */
  sleepNow(): void {
    if (this.session.state !== "started" || this.store.getState().sleep === "asleep") return;
    this.clearSleepTimers();
    this.store.setState({ sleep: "asleep" });
    this.emitSession("slept");
  }

  wake(): void {
    if (this.session.state !== "started") return;
    const wasAsleep = this.store.getState().sleep === "asleep";
    this.wakeDisplay();
    if (wasAsleep) this.emitSession("woke");
  }

  setSleepTimeout(ms: number): void {
    this.store.setState({ sleepTimeoutMs: ms });
    if (this.session.state === "started" && this.store.getState().sleep === "awake") {
      this.armIdleTimer();
    }
  }

  /** SIM-SES-05: the glasses drop off (out of range, battery). */
  disconnect(): void {
    if (!this.store.getState().connected) return;
    this.restartOnReconnect = this.session.state === "started" || this.session.state === "starting";
    this.store.setState({ connected: false, interrupted: false });
    this.endDisplay();
    this.setSession("stopped");
    this.emitSession("disconnected");
  }

  async reconnect(): Promise<void> {
    const s = this.store.getState();
    if (s.connected || s.reconnecting) return;
    this.store.setState({ reconnecting: true });
    await wait(RECONNECT_DELAY_MS);
    this.store.setState({ connected: true, reconnecting: false });
    if (this.restartOnReconnect) {
      this.restartOnReconnect = false;
      await this.startSession();
    }
    this.emitSession("reconnected");
  }

  // ---- Sleep timers ----

  private wakeDisplay(): void {
    this.store.setState({ sleep: "awake" });
    this.armIdleTimer();
  }

  private armIdleTimer(): void {
    this.clearSleepTimers();
    this.idleTimer = setTimeout(() => {
      if (this.session.state !== "started") return;
      this.store.setState({ sleep: "dimmed" });
      this.sleepTimer = setTimeout(() => this.sleepNow(), DIM_BEFORE_SLEEP_MS);
    }, this.store.getState().sleepTimeoutMs);
  }

  private clearSleepTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.idleTimer = null;
    this.sleepTimer = null;
  }

  onSessionEvent(handler: (e: SessionEvent) => void): () => void {
    this.sessionHandlers.add(handler);
    return () => this.sessionHandlers.delete(handler);
  }

  // ---- Simulator-only controls (control strip, not the app) ----

  /**
   * Neural Band stand-in from the camera: hand shapes the camera sees become gestures, logged
   * with source "camera". Returns a detach function.
   */
  attachCameraGestures(feed: HandsFeed): () => void {
    const recognizer = new CameraGestureRecognizer({
      mirrored: () => this.store.getState().cameraGesturesMirrored,
    });
    return feed.subscribe((frame) => {
      if (!this.store.getState().cameraGestures) return;
      const gestures = recognizer.update(
        frame.hands.map((h) => h.landmarks),
        frame.at,
      );
      for (const g of gestures) this.emitGesture(g, `camera ${CAMERA_SOURCE[g]}`);
    });
  }

  setCameraGestures(on: boolean): void {
    this.store.setState({ cameraGestures: on });
  }

  setCameraGesturesMirrored(mirrored: boolean): void {
    this.store.setState({ cameraGesturesMirrored: mirrored });
  }

  /** Audio-only mode simulates Ray-Ban Meta Gen 2: no display. */
  setAudioOnly(audioOnly: boolean): void {
    this.store.setState({ audioOnly });
  }

  /**
   * A gesture from the pad or a key. While disconnected nothing arrives. While the display is
   * asleep the gesture only wakes it ([ASSUMPTION] the waking gesture is consumed); while dimmed
   * it undims and is delivered. Any gesture resets the idle timer.
   */
  emitGesture(gesture: GlassesGesture, source = "pad"): void {
    const s = this.store.getState();
    if (!s.connected) {
      this.logGesture(gesture, source, "ignored: disconnected");
      this.warn(`gesture "${gesture}" ignored: glasses disconnected`);
      return;
    }
    if (s.session === "started") {
      if (s.sleep === "asleep") {
        this.logGesture(gesture, source, "woke the display");
        this.wake();
        return;
      }
      this.wakeDisplay();
    }
    this.logGesture(gesture, source, "delivered");
    for (const handler of [...this.gestureHandlers]) handler(gesture);
  }

  /** SIM-GST-02: rolling log of gestures received. */
  private logGesture(gesture: GlassesGesture, source: string, result: GestureLogEntry["result"]) {
    const entry: GestureLogEntry = { gesture, source, result, at: Date.now() };
    const log = [entry, ...this.store.getState().gestureLog].slice(0, GESTURE_LOG_SIZE);
    this.store.setState({ gestureLog: log });
  }

  // ---- Input ----

  async startCamera(): Promise<MediaStream> {
    const media = assertMediaAvailable();
    let stream: MediaStream;
    try {
      stream = await media.getUserMedia({
        // The glasses camera faces forward like a phone's rear camera. Laptops use their only one.
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
    } catch (error) {
      throw mediaError(error, "Camera");
    }
    this.streams.add(stream);
    this.camera = stream;
    return stream;
  }

  async captureStill(): Promise<Blob> {
    const stream = this.camera;
    const live = stream?.getVideoTracks().some((t) => t.readyState === "live");
    if (!stream || !live) {
      throw new GlassesError("camera-off", "Start the camera before capturing a page.");
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await video.play();
      if (!video.videoWidth) {
        await new Promise<void>((resolve) =>
          video.addEventListener("loadeddata", () => resolve(), { once: true }),
        );
      }
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (!blob) throw new Error("toBlob returned null");
      return blob;
    } catch (error) {
      throw new GlassesError("unknown", "The page photo could not be taken.", { cause: error });
    } finally {
      video.pause();
      video.srcObject = null;
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
      throw mediaError(error, "Microphone");
    }

    // OPEN QUESTION: Gemini Live's expected input format (16 kHz mono PCM16?). This emits mono
    // PCM16 at the AudioContext's native rate; resampling belongs to src/live/.
    const context = new AudioContext();
    const url = URL.createObjectURL(new Blob([MIC_WORKLET_SOURCE], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(context, "pcm-capture");
      node.port.onmessage = (event: MessageEvent<Float32Array>) =>
        onAudio(floatToInt16(event.data));
      context.createMediaStreamSource(stream).connect(node);
      this.mic = { stream, context, node, url };
    } catch (error) {
      URL.revokeObjectURL(url);
      void context.close();
      for (const track of stream.getTracks()) track.stop();
      throw new GlassesError("unsupported", "Audio capture is not supported here.", {
        cause: error,
      });
    }
  }

  stopMic(): void {
    const mic = this.mic;
    if (!mic) return;
    this.mic = null;
    mic.node.port.onmessage = null;
    mic.node.disconnect();
    void mic.context.close();
    URL.revokeObjectURL(mic.url);
    for (const track of mic.stream.getTracks()) track.stop();
  }

  onGesture(handler: (g: GlassesGesture) => void): () => void {
    this.gestureHandlers.add(handler);
    this.attachKeys();
    return () => {
      this.gestureHandlers.delete(handler);
      if (this.gestureHandlers.size === 0) this.detachKeys();
    };
  }

  // ---- Output ----

  /** Display calls only work while the session is started (SIM-SES-01). */
  private canDisplay(method: string): boolean {
    const state = this.session.state;
    if (state === "started") return true;
    this.warn(`${method} ignored: session is ${state}`);
    return false;
  }

  /** Change the requested item (and/or status); the display updates on the next flush. */
  private request(patch: { item?: DisplayContent | null; status?: StatusKind | null }): void {
    this.store.setState(patch);
    this.scheduleFlush();
  }

  showPhrase(text: string, opts?: { emphasis?: [number, number] }): void {
    if (this.canDisplay("showPhrase")) {
      this.request({ item: makePhrase(text, opts?.emphasis, this.warn) });
    }
  }

  showWordCard(card: WordCard): void {
    if (this.canDisplay("showWordCard")) this.request({ item: makeWordCard(card, this.warn) });
  }

  showImage(url: string): void {
    if (!this.canDisplay("showImage")) return;
    if (!this.capabilities.display) {
      this.warn("showImage ignored: no display (audio-only mode)");
      return;
    }
    this.request({ item: makeImage(url) });
  }

  showStatus(kind: StatusKind | null): void {
    if (this.canDisplay("showStatus")) this.request({ status: kind });
  }

  clearDisplay(): void {
    if (this.canDisplay("clearDisplay")) this.request({ item: null, status: null });
  }

  /** SIM-DSP-04: at most maxUpdatesPerSecond whole-screen updates; the latest request wins. */
  setMaxUpdatesPerSecond(rate: number): void {
    this.store.setState({ maxUpdatesPerSecond: Math.max(1, Math.min(20, rate)) });
  }

  private scheduleFlush(): void {
    const interval = 1000 / this.store.getState().maxUpdatesPerSecond;
    const wait = this.lastFlushAt + interval - Date.now();
    if (wait <= 0 && !this.flushTimer) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), Math.max(0, wait));
    }
  }

  /** SIM-DSP-02: build and replace the WHOLE scene; count the update. */
  private flush(): void {
    this.flushTimer = null;
    this.lastFlushAt = Date.now();
    const { item, status, updateCount } = this.store.getState();
    this.store.setState({
      scene: buildScene(item, status),
      updateCount: updateCount + 1,
      lastUpdateAt: this.lastFlushAt,
    });
  }

  private cancelFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
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

  stopSpeaking(): void {
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
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
        gain.gain.exponentialRampToValueAtTime(CUE_GAIN, t + 0.01);
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
    this.sessionHandlers.clear();
    this.detachKeys();
    this.stopMic();
    for (const stream of this.streams) for (const t of stream.getTracks()) t.stop();
    this.streams.clear();
    this.camera = null;
    if (this.cueContext) {
      void this.cueContext.close();
      this.cueContext = null;
    }
    this.stopSpeaking();
    this.clearSleepTimers();
    this.cancelFlush();
    this.store.setState({
      session: "stopped",
      item: null,
      status: null,
      scene: null,
      sleep: "awake",
    });
  }

  // ---- Internals ----

  private readonly handleKey = (event: Event): void => {
    const gesture = keyToGesture(event as KeyboardEvent);
    if (!gesture) return;
    event.preventDefault();
    const key = (event as KeyboardEvent).key;
    this.emitGesture(gesture, `key ${key === " " ? "Space" : key}`);
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
}
