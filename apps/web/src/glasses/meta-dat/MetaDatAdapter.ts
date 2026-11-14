// MetaDatAdapter: future adapter for real Meta glasses via the Wearables Device Access Toolkit
// (DAT). Stub only: every method throws "not implemented". No Meta or Expo packages installed.
//
// The mapping below is what we know from the DAT SDK 0.6 surface as exposed by the community
// wrapper we evaluated before the web migration (registration, permissions, device sessions,
// camera streaming, photo capture, mock devices). Anything that wrapper did NOT expose is marked
// OPEN QUESTION. Full table: docs/glasses-adapter.md.
//
// OPEN QUESTION: DAT is a native (iOS/Android) SDK. How does a web app reach it? Options: a thin
// native companion app that bridges to this web app (WebView / local WebSocket), or a native
// shell. Not decided; this adapter assumes some bridge exists.
import {
  type Cue,
  type Gesture,
  type GlassesAdapter,
  type GlassesCapabilities,
  GlassesError,
  type WordCard,
} from "../adapter";

function notImplemented(method: string): never {
  throw new GlassesError("not-implemented", `MetaDatAdapter.${method} is not implemented yet.`);
}

export class MetaDatAdapter implements GlassesAdapter {
  // DAT: Device.deviceType ("metaRayBanDisplay" -> display true, 600x600; "rayBanMeta" Gen 2 ->
  // display false). Before connecting we assume the safe audio-only case.
  // OPEN QUESTION: does DAT report display size, or do we hard-code it per device type?
  // OPEN QUESTION: does DAT expose Neural Band at all? Assume no until confirmed.
  readonly capabilities: GlassesCapabilities = { display: false, neuralBand: false };

  // DAT: createSession(deviceId) -> startSession -> addStreamToSession({ resolution, frameRate }),
  // after startRegistration() (via the Meta AI app) and requestPermission("camera").
  // OPEN QUESTION: DAT renders frames into a native view and reports frame metadata; it does not
  // hand JS a MediaStream. We need a bridge that turns frames into a MediaStream (or change this
  // method to return frames). Photo capture (capturePhoto) is a fallback for page snapshots.
  // OPEN QUESTION: GlassesAdapter has no connect/register step; DAT needs one.
  startCamera(): Promise<MediaStream> {
    return notImplemented("startCamera");
  }

  // DAT: not part of the camera/session API we saw. The glasses mic normally reaches the phone
  // as a Bluetooth audio input (OS level), not through DAT.
  // OPEN QUESTION: confirm the mic route and whether the bridge can forward PCM to the web app.
  startMic(_onAudio: (pcm: Int16Array) => void): Promise<void> {
    return notImplemented("startMic");
  }

  // DAT: Neural Band / touchpad gestures were not exposed by the wrapper we evaluated.
  // OPEN QUESTION: is there a DAT API for Neural Band events? If not, fall back to phone taps.
  onGesture(_handler: (g: Gesture) => void): () => void {
    return notImplemented("onGesture");
  }

  // DAT: display output. OPEN QUESTION: the wrapper exposed no display API and lists Ray-Ban
  // Display as untested. Needs the official DAT display docs or a custom native module.
  showPhrase(_text: string, _opts?: { emphasis?: [number, number] }): void {
    notImplemented("showPhrase");
  }

  // DAT: display output (as showPhrase). OPEN QUESTION, same as above.
  showWordCard(_card: WordCard): void {
    notImplemented("showWordCard");
  }

  // DAT: display output (as showPhrase). Only when capabilities.display. OPEN QUESTION.
  showImage(_url: string): void {
    notImplemented("showImage");
  }

  // DAT: display output (as showPhrase). OPEN QUESTION.
  clearDisplay(): void {
    notImplemented("clearDisplay");
  }

  // DAT: none. Speech is phone-side TTS played through the glasses speakers as a Bluetooth
  // audio output (OS level). OPEN QUESTION: confirm routing through the bridge.
  speak(_text: string): Promise<void> {
    return notImplemented("speak");
  }

  // DAT: none. Same audio route as speak(). Primary feedback channel on Gen 2 (no display).
  playCue(_kind: Cue): void {
    notImplemented("playCue");
  }

  // DAT: stopSession(sessionId) for each open session; remove event listeners.
  dispose(): void {
    notImplemented("dispose");
  }
}
