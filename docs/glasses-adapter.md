# Glasses adapter

All glasses I/O in the web app goes through one interface, `GlassesAdapter`
(`apps/web/src/glasses/adapter.ts`), defined in `SIMULATION_FEATURES.md` section 6. Today the
browser stands in for the glasses (`WebSimulatorAdapter`). Later a `MetaDatAdapter` will talk
to real Meta glasses through the Meta Wearables Device Access Toolkit (DAT) without the rest of
the app changing.

**Rule:** `navigator.mediaDevices` and browser audio APIs (`AudioContext`, `speechSynthesis`,
...) may only be used inside `apps/web/src/glasses/web-simulator/`. ESLint enforces this.

The full feature list (requirement IDs, priorities, acceptance tests) is in
`SIMULATION_FEATURES.md`. This file is the method-by-method mapping.

## Input actions

Six abstract actions; the system converts Neural Band and touchpad input into actions for the
app [VERIFIED], but the exact event names a third-party app receives are **OPEN**.

| Real gesture | Action | Simulator key |
|---|---|---|
| Thumb-index pinch | `select` | `Enter` |
| Thumb-middle pinch | `back` | `Escape` |
| Thumb swipe right / left | `right` / `left` | `ArrowRight` / `ArrowLeft` |
| Thumb swipe down / up | `down` / `up` | `ArrowDown` / `ArrowUp` |
| Double tap middle on thumb | system wake/sleep (not an app action) | Sleep/Wake button |
| Frame touchpad | same actions | on-screen pad |

In the simulation the camera is the eyes: thumb-index pinch = `select`, thumb-middle pinch =
`back`, open-palm swipes = `left`/`right`/`up`/`down`, recognised from the camera's hand frames
inside the web simulator (`web-simulator/cameraGestures.ts`) and delivered through `onGesture`
like band events. A pointing finger is the reading cursor (app vision), never a gesture.

## Method mapping

| `GlassesAdapter` | Web simulator | Meta DAT (planned `MetaDatAdapter`) |
|---|---|---|
| `capabilities` | `display` follows the audio-only toggle; 600x600; band and touchpad simulated | Device type: Ray-Ban Display has the display, Ray-Ban Meta Gen 2 does not. OPEN: which inputs apps receive. |
| `session.start/stop`, `session.state` | Simulated state machine with a 1-2 s start | Display session `stopped → starting → started → stopping`, user-initiated, exclusive while running [VERIFIED]. |
| `onSessionEvent` | Control-strip buttons: Interrupt/Resume, Sleep/Wake (and idle timeout), Disconnect/Reconnect | System interruptions (calls, notifications), display sleep/wake, device link state. |
| `startCamera()` | `getUserMedia({ video })` | Registration via the Meta AI app, camera permission, then `createSession → startSession → addStreamToSession`. OPEN: DAT does not hand JS a `MediaStream`. |
| `captureStill()` | Current frame drawn to a canvas → JPEG | `capturePhoto("jpeg")`; the photo arrives via `onPhotoCaptured`. |
| `startMic` / `stopMic` | `getUserMedia({ audio })` + AudioWorklet → PCM16 | Not DAT: the glasses mic reaches the phone as Bluetooth audio. OPEN: route and format. |
| `onGesture` | Keys + gesture pad | System input actions [VERIFIED]; names OPEN. |
| `showPhrase` / `showWordCard` / `showImage` / `showStatus` / `clearDisplay` | Panel built only from FlexBox, Text, Image, Button, Icon equivalents; whole-screen updates | Display components (flexbox, text presets, image, button, system icon); each update replaces the whole screen [VERIFIED]. |
| `speak` / `stopSpeaking` | `speechSynthesis` | Not DAT: phone TTS over Bluetooth audio. |
| `playCue` | Web Audio tones + visual badge | Not DAT: same audio route. |
| `dispose` | Stops tracks, mic, audio, key listener | Stop the display and camera sessions. |

## Open questions

- How a web app reaches DAT at all (companion-app bridge or native shell).
- Exact input actions apps receive; whether apps can trigger Neural Band haptics.
- Whether the display moves focus between buttons itself (we re-render the card with `focused`).
- Display text limits, letter spacing and custom fonts.
- Camera frames: DAT gives native frames and photos, not a `MediaStream`.
- Whether Meta's Web Apps path gets camera, mic and audio.
