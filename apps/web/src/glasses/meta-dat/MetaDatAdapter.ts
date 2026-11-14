// MetaDatAdapter: future adapter for real Meta glasses via the Wearables Device Access Toolkit
// (DAT). Stub only: every method throws "not implemented". No Meta or Expo packages installed.
//
// Mapping sources: Meta's display access overview (components, 600x600, whole-screen updates,
// session lifecycle, touchpad/Neural Band input), and the DAT 0.6 camera surface as exposed by
// the community React Native wrapper we evaluated before the web migration (registration,
// camera permission, device sessions, streaming, photo capture). Full table and open questions:
// docs/glasses-adapter.md and SIMULATION_FEATURES.md.
//
// OPEN QUESTION: DAT is a native (iOS/Android) SDK. How does a web app reach it (companion app
// bridge or native shell)? This adapter assumes some bridge exists.
import {
  type Cue,
  type GlassesAdapter,
  type GlassesCapabilities,
  GlassesError,
  type GlassesGesture,
  type GlassesSession,
  type SessionEvent,
  type StatusKind,
  type WordCard,
} from "../adapter";

function notImplemented(method: string): never {
  throw new GlassesError("not-implemented", `MetaDatAdapter.${method} is not implemented yet.`);
}

export class MetaDatAdapter implements GlassesAdapter {
  // DAT: device type (Ray-Ban Display has the 600x600 display; Ray-Ban Meta Gen 2 has none).
  // Before connecting we assume the safe audio-only case.
  // OPEN QUESTION: which input actions third-party apps receive from band and touchpad.
  readonly capabilities: GlassesCapabilities = {
    display: false,
    neuralBand: false,
    touchpad: false,
  };

  // DAT display session: stopped -> starting -> started -> stopping. The user must start it;
  // the app gets exclusive display control while it runs. [VERIFIED in Meta's display docs]
  readonly session: GlassesSession = {
    get state() {
      return notImplemented("session.state");
    },
    start: () => notImplemented("session.start"),
    stop: () => notImplemented("session.stop"),
  };

  // DAT: session state changes from the system (interrupted by calls/notifications, display
  // sleep/wake, device link state for disconnect/reconnect).
  onSessionEvent(_handler: (e: SessionEvent) => void): () => void {
    return notImplemented("onSessionEvent");
  }

  // DAT: startRegistration() (via the Meta AI app), requestPermission("camera"), then
  // createSession -> startSession -> addStreamToSession({ resolution, frameRate }).
  // OPEN QUESTION: DAT renders frames natively and reports frame metadata; it does not hand JS a
  // MediaStream. The bridge has to produce one (or this method changes).
  startCamera(): Promise<MediaStream> {
    return notImplemented("startCamera");
  }

  // DAT: capturePhoto("jpeg") on a streaming session; the photo arrives via onPhotoCaptured as
  // a file path (optionally base64). The bridge would turn it into a Blob.
  captureStill(): Promise<Blob> {
    return notImplemented("captureStill");
  }

  // DAT: not part of the camera/session API. The glasses mic normally reaches the phone as a
  // Bluetooth audio input (OS level). OPEN QUESTION: route and format through the bridge.
  startMic(_onAudio: (pcm: Int16Array) => void): Promise<void> {
    return notImplemented("startMic");
  }

  // DAT: stop the Bluetooth audio capture started above.
  stopMic(): void {
    notImplemented("stopMic");
  }

  // DAT: input actions converted by the system from the touchpad and Neural Band and delivered
  // to the app [VERIFIED]. OPEN QUESTION: the exact event names (select/back/directional?).
  onGesture(_handler: (g: GlassesGesture) => void): () => void {
    return notImplemented("onGesture");
  }

  // DAT display: a Text component (body preset) in a FlexBox; the emphasised span as a
  // separate Text with a stronger preset. Each update replaces the whole screen.
  showPhrase(_text: string, _opts?: { emphasis?: [number, number] }): void {
    notImplemented("showPhrase");
  }

  // DAT display: FlexBox with Text (heading = word, body = definition) and Buttons for
  // "Hear it" / "Picture it". OPEN QUESTION: how button focus/selection works.
  showWordCard(_card: WordCard): void {
    notImplemented("showWordCard");
  }

  // DAT display: Image component from a URL (size, corner radius).
  showImage(_url: string): void {
    notImplemented("showImage");
  }

  // DAT display: system Icon + Text (meta preset), re-sent with the current item.
  showStatus(_kind: StatusKind | null): void {
    notImplemented("showStatus");
  }

  // DAT display: an empty scene (black is see-through). [ASSUMPTION]
  clearDisplay(): void {
    notImplemented("clearDisplay");
  }

  // DAT: none. Phone-side TTS played through the glasses speakers over Bluetooth audio.
  speak(_text: string): Promise<void> {
    return notImplemented("speak");
  }

  // DAT: none. Stop phone-side TTS.
  stopSpeaking(): void {
    notImplemented("stopSpeaking");
  }

  // DAT: none. Same audio route as speak(). Main feedback channel on Gen 2 (no display).
  playCue(_kind: Cue): void {
    notImplemented("playCue");
  }

  // DAT: stop the display session and any camera stream sessions; remove listeners.
  dispose(): void {
    notImplemented("dispose");
  }
}
