// The browser standing in for Meta glasses + Meta Neural Band:
//   browser camera          -> glasses point-of-view camera (privacy LED lit while on)
//   capture to canvas       -> capture button photo
//   browser mic / speaker   -> glasses mic / open-ear speakers
//   speech recognition      -> voice commands (push-to-talk, optional wake phrase)
//   simulator panel         -> Ray-Ban Display (600x600, ~20 deg FOV, right lens)
//   keys + on-screen btns   -> Neural Band, temple touchpad, capture button
//   panel toggles           -> worn / folded / connected / battery, and Gen 2 audio-only
//
// This folder is the ONLY place allowed to use navigator.mediaDevices, browser audio and speech
// APIs (enforced by ESLint).
import {
  type Cue,
  type Gesture,
  type GlassesAdapter,
  type GlassesCapabilities,
  GlassesError,
  type GlassesState,
  RAY_BAN_DISPLAY_SIZE,
  type WordCard,
} from "../adapter";
import { makeImage, makePhrase, makeWordCard } from "../simulator-ui/displayModel";
import { createSimulatorStore, type SimulatorStore } from "../simulator-ui/simulatorStore";
import { type DeviceInput, INPUT_ACTIONS, keyToInput } from "./gestures";
import { MIC_WORKLET_SOURCE, floatToInt16 } from "./micWorklet";
import { SpeechRecognizer } from "./voice";

type KeyTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export interface WebSimulatorOptions {
  /** Where to listen for input keys. Defaults to `window`. */
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
  shutter: [
    [1800, 0.02],
    [1200, 0.03],
  ],
  listening: [
    [520, 0.06],
    [780, 0.08],
  ],
};

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

function clamp01(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
}

export class WebSimulatorAdapter implements GlassesAdapter {
  readonly store: SimulatorStore = createSimulatorStore();

  private readonly keyTarget: KeyTarget | null;
  private readonly gestureHandlers = new Set<(g: Gesture) => void>();
  private readonly utteranceHandlers = new Set<(text: string) => void>();
  private readonly stateHandlers = new Set<(s: GlassesState) => void>();
  private keyListenerAttached = false;
  private camera: MediaStream | null = null;
  private readonly micStreams = new Set<MediaStream>();
  private cueContext: AudioContext | null = null;
  private mic: { context: AudioContext; node: AudioWorkletNode; url: string } | null = null;
  private recognizer: SpeechRecognizer | null = null;
  /** A push-to-talk listen() waiting for an answer (typed commands can resolve it too). */
  private pendingListen: ((text: string) => void) | null = null;

  constructor(options: WebSimulatorOptions = {}) {
    this.keyTarget = options.keyTarget ?? (typeof window !== "undefined" ? window : null);
    // Tell subscribers about device state changes (from the panel or from the adapter itself).
    this.store.subscribe((s, prev) => {
      if (s.device === prev.device) return;
      for (const handler of [...this.stateHandlers]) handler(s.device);
    });
  }

  get capabilities(): GlassesCapabilities {
    const display = !this.store.getState().audioOnly;
    return {
      display,
      displaySize: display ? { ...RAY_BAN_DISPLAY_SIZE } : undefined,
      // Simulated by keys and on-screen buttons.
      neuralBand: true,
      // Typed commands always work in the simulator, even without browser speech recognition.
      voice: true,
    };
  }

  get state(): GlassesState {
    return this.store.getState().device;
  }

  onStateChange(handler: (state: GlassesState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  // ---- Simulator-only controls (used by the simulator panel, not by the app) ----

  /** Audio-only mode simulates Ray-Ban Meta Gen 2: the display goes blank. */
  setAudioOnly(audioOnly: boolean): void {
    this.store.setState({ audioOnly });
  }

  /** Change the simulated physical state. Folding or disconnecting stops the camera. */
  setDevice(patch: Partial<Omit<GlassesState, "cameraActive">>): void {
    const next = { ...this.state, ...patch };
    if (next.battery <= 0) next.connected = false;
    next.battery = Math.max(0, Math.min(100, Math.round(next.battery)));
    next.volume = clamp01(next.volume);
    this.updateDevice(next);
    if (next.folded || !next.connected) this.stopCamera();
    if (!next.worn || next.folded || !next.connected) this.stopSpeaking();
  }

  /** A simulated hardware input (Neural Band, touchpad, capture button). */
  press(input: DeviceInput): void {
    if (!this.state.connected) return;
    this.store.setState({ lastInput: { input, at: Date.now() } });
    const action = INPUT_ACTIONS[input];
    if (action.kind === "volume") {
      // Volume is handled on the device, like real glasses: no app involvement.
      this.updateDevice({ ...this.state, volume: clamp01(this.state.volume + action.delta) });
      this.playCue("tick");
      return;
    }
    this.emitGesture(action.gesture);
  }

  /** Deliver an app intent directly (tests, and inputs that already map to one). */
  emitGesture(gesture: Gesture): void {
    if (!this.state.connected) return;
    for (const handler of [...this.gestureHandlers]) handler(gesture);
  }

  /** A typed voice command (for browsers without speech recognition, and for tests). */
  simulateUtterance(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.store.setState({ lastHeard: { text: trimmed, at: Date.now() } });
    if (this.pendingListen) {
      const resolve = this.pendingListen;
      this.pendingListen = null;
      this.store.setState({ listening: false });
      resolve(trimmed);
      return;
    }
    for (const handler of [...this.utteranceHandlers]) handler(trimmed);
  }

  /** Simulator-only: keep listening for the wake phrase ("hey meta ..."). */
  setWakeListening(on: boolean): void {
    if (!SpeechRecognizer.isSupported()) return;
    this.recognizer ??= new SpeechRecognizer();
    if (on) {
      this.recognizer.startWake((command) => {
        this.playCue("listening");
        if (command) this.simulateUtterance(command);
      });
    } else {
      this.recognizer.stopWake();
    }
    this.store.setState({ wakeListening: on });
  }

  speechRecognitionSupported(): boolean {
    return SpeechRecognizer.isSupported();
  }

  // ---- Input ----

  async startCamera(): Promise<MediaStream> {
    if (!this.state.connected) {
      throw new GlassesError("glasses-unavailable", "The glasses are not connected.");
    }
    if (this.state.folded) {
      throw new GlassesError("glasses-unavailable", "The glasses are folded. Unfold them first.");
    }
    if (this.camera) return this.camera;
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
    this.camera = stream;
    // If the browser or OS ends the camera (e.g. permission revoked), reflect it.
    for (const track of stream.getVideoTracks()) {
      track.addEventListener("ended", () => {
        if (this.camera === stream) this.stopCamera();
      });
    }
    this.store.setState({ cameraStream: stream });
    this.updateDevice({ ...this.state, cameraActive: true });
    return stream;
  }

  stopCamera(): void {
    const stream = this.camera;
    if (!stream) return;
    this.camera = null;
    for (const track of stream.getTracks()) track.stop();
    const { content } = this.store.getState();
    this.store.setState({
      cameraStream: null,
      content: content?.kind === "viewfinder" ? null : content,
    });
    this.updateDevice({ ...this.state, cameraActive: false });
  }

  async capturePhoto(): Promise<Blob> {
    const stream = this.camera;
    if (!stream) throw new GlassesError("camera-off", "Start the camera before taking a photo.");
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
      this.playCue("shutter");
      this.store.setState({ flashAt: Date.now() });
      return blob;
    } catch (error) {
      throw new GlassesError("unknown", "The photo could not be taken.", { cause: error });
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
    this.micStreams.add(stream);

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
      for (const track of stream.getTracks()) track.stop();
      this.micStreams.delete(stream);
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

  async listen(): Promise<string> {
    if (!this.state.connected) {
      throw new GlassesError("glasses-unavailable", "The glasses are not connected.");
    }
    // A second press while listening cancels the first.
    if (this.pendingListen) {
      const resolve = this.pendingListen;
      this.pendingListen = null;
      resolve("");
    }
    this.playCue("listening");
    this.store.setState({ listening: true });
    const typed = new Promise<string>((resolve) => {
      this.pendingListen = resolve;
    });
    if (!SpeechRecognizer.isSupported()) {
      // No browser speech recognition: wait for a typed command in the simulator panel.
      return typed;
    }
    this.recognizer ??= new SpeechRecognizer();
    const spoken = this.recognizer.listenOnce().then(
      (text) => {
        if (text) this.store.setState({ lastHeard: { text, at: Date.now() } });
        return text;
      },
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : "";
        throw new GlassesError(
          reason === "permission-denied" ? "permission-denied" : "unknown",
          reason === "permission-denied"
            ? "Microphone permission was denied."
            : "Voice recognition failed.",
          { cause: error },
        );
      },
    );
    try {
      return await Promise.race([spoken, typed]);
    } finally {
      this.pendingListen = null;
      this.store.setState({ listening: false, wakeListening: this.recognizer.isWakeListening() });
    }
  }

  onUtterance(handler: (text: string) => void): () => void {
    this.utteranceHandlers.add(handler);
    return () => this.utteranceHandlers.delete(handler);
  }

  // ---- Output ----
  // The simulated display keeps exactly one item; each call replaces it. The panel shows it only
  // while the display is on (worn, unfolded, connected, not audio-only).

  showPhrase(text: string, opts?: { emphasis?: [number, number] }): void {
    this.store.setState({ content: makePhrase(text, opts?.emphasis) });
  }

  showWordCard(card: WordCard): void {
    this.store.setState({ content: makeWordCard(card) });
  }

  showImage(url: string): void {
    this.store.setState({ content: makeImage(url) });
  }

  showViewfinder(): void {
    this.store.setState({ content: { kind: "viewfinder" } });
  }

  clearDisplay(): void {
    this.store.setState({ content: null });
  }

  speak(text: string): Promise<void> {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    const { connected, worn, folded, volume } = this.state;
    if (!synth || !text.trim() || !connected || !worn || folded) return Promise.resolve();
    // Newest request wins: read-along should not queue up stale phrases.
    synth.cancel();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.volume = volume;
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
    const { connected, volume } = this.state;
    if (!connected || volume <= 0 || typeof AudioContext === "undefined") return;
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
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.25 * volume), t + 0.01);
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
    this.utteranceHandlers.clear();
    this.stateHandlers.clear();
    this.detachKeys();
    this.stopCamera();
    for (const stream of this.micStreams) for (const t of stream.getTracks()) t.stop();
    this.micStreams.clear();
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
    this.recognizer?.stopWake();
    this.pendingListen = null;
    this.stopSpeaking();
    this.store.setState({ content: null, listening: false, wakeListening: false });
  }

  // ---- Internals ----

  private updateDevice(device: GlassesState): void {
    this.store.setState({ device });
  }

  private readonly handleKey = (event: Event): void => {
    const input = keyToInput(event as KeyboardEvent);
    if (!input) return;
    event.preventDefault();
    this.press(input);
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
