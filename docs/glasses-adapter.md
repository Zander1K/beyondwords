# Glasses adapter

All glasses I/O in the web app goes through one interface, `GlassesAdapter`
(`apps/web/src/glasses/adapter.ts`). Today the browser stands in for the glasses
(`WebSimulatorAdapter`). Later a `MetaDatAdapter` will talk to real Meta glasses through the
Meta Wearables Device Access Toolkit (DAT) without the rest of the app changing.

**Rule:** `navigator.mediaDevices`, browser audio APIs (`AudioContext`, `speechSynthesis`, ...)
and speech recognition may only be used inside `apps/web/src/glasses/web-simulator/`. ESLint
enforces this.

Only features relevant to reading are simulated. Video recording, calls, music, messaging and
navigation are left out; add them here when a use case needs them.

## Simulator mapping

| Real glasses | Web simulator |
|---|---|
| Point-of-view camera (aimed at the page) | Browser camera via `getUserMedia` (rear camera preferred) |
| Privacy LED (lit while the camera is in use) | LED on the simulated frame, flashes on capture |
| Capture button (photo) | `C` key / button: a JPEG of the current frame, in memory only |
| Viewfinder on the display | Live camera view in the display panel, to line up the page |
| Glasses mic | Browser mic via `getUserMedia` + AudioWorklet, emitted as PCM16 |
| Open-ear speakers | `speechSynthesis` for speech, Web Audio tones for cues, both at the device volume |
| Ray-Ban Display (600x600, ~20° FOV, right lens) | Display simulator panel (`simulator-ui/`) |
| Ray-Ban Meta Gen 2 (no display) | "Audio-only" toggle (`capabilities.display = false`) |
| Worn / folded / connected / battery | Device-state switches. Off-face, folded or disconnected blanks the display and stops speech; folding or disconnecting stops the camera; 0% battery disconnects |
| Voice | Browser speech recognition: push-to-talk, plus an optional wake phrase; typed fallback |

### Hardware inputs

Inputs are translated into app intents (`Gesture`) inside the adapter, so the app never knows
which device sent them. Volume is handled on the device, like the real glasses.

| Device | Input | Key | Intent |
|---|---|---|---|
| Meta Neural Band | Thumb swipe forward / back | `→` / `←` | `next` / `prev` |
| Meta Neural Band | Index pinch | `Enter` | `select` (word card) |
| Meta Neural Band | Middle pinch | `Esc` | `dismiss` (back) |
| Meta Neural Band | Pinch and twist | `+` / `-` | volume up / down (device) |
| Temple touchpad | Tap | `Space` | `play-pause` (read aloud / stop) |
| Temple touchpad | Swipe forward / back | buttons | volume up / down (device) |
| Temple touchpad | Tap and hold | `V` | `assistant` (push-to-talk) |
| Capture button | Press | `C` | `capture` (photo of the page) |

OPEN QUESTION: the gesture names follow Meta's public descriptions and must be confirmed, along
with which of these inputs DAT forwards to third-party apps (the touchpad hold and capture button
may stay reserved for Meta AI and the system camera).

The simulator panel enforces the real display's limits itself: one item at a time (a short
phrase, a word card or an image), no newlines, no scrolling paragraphs; long text is cut at a
word boundary with an ellipsis. The character limits are a HACK pending real numbers (see open
questions).

## Method mapping to Meta DAT

Source: the DAT SDK 0.6 surface as exposed by the community React Native wrapper
`expo-meta-wearables-dat`, which we evaluated before moving to the web. It covers
registration via the Meta AI app, camera permission, device discovery, device sessions,
camera streaming, photo capture and a mock device kit. It does **not** expose display output
or Neural Band input, and lists Ray-Ban Display as untested. Anything not confirmed is marked
**OPEN QUESTION**.

| `GlassesAdapter` | Web simulator | Meta DAT (planned `MetaDatAdapter`) |
|---|---|---|
| `capabilities` | `display` follows the audio-only toggle; 600x600; `neuralBand: true` (simulated) | From the device type: `metaRayBanDisplay` has a display, `rayBanMeta` (Gen 2) does not. OPEN QUESTION: does DAT report display size? Does it expose Neural Band? |
| `state` / `onStateChange` | Simulator switches + volume inputs | Link state and device events (DAT reports connected / disconnected; the mock kit has don/doff and fold/unfold; streams fail with `hingesClosed`). OPEN QUESTION: battery and volume reporting. |
| `startCamera()` | `getUserMedia({ video })` | `startRegistration()` (Meta AI app), `requestPermission("camera")`, then `createSession` → `startSession` → `addStreamToSession`. OPEN QUESTION: DAT renders frames natively and reports frame metadata; it does not return a `MediaStream`. `capturePhoto` is a fallback for page snapshots. |
| `stopCamera()` | Stops tracks, LED off | `stopSession` / `removeStreamFromSession`. The LED is driven by the device. |
| `capturePhoto()` | Draws the current frame to a canvas → JPEG `Blob`, shutter cue, LED flash | `capturePhoto("jpeg")` on a streaming session; the photo arrives via `onPhotoCaptured` (file path, optional base64). |
| `listen()` / `onUtterance()` | Speech recognition (push-to-talk, wake phrase), typed box | No DAT equivalent: mic audio → Gemini Live. OPEN QUESTION: can a DAT app use a wake word or the touchpad hold? "Hey Meta" wakes Meta AI. |
| `startMic(onAudio)` | `getUserMedia({ audio })` + AudioWorklet → PCM16 at the context rate | Not part of DAT's camera/session API. The glasses mic normally reaches the phone as a Bluetooth audio input. OPEN QUESTION: route and format. |
| `onGesture(handler)` | Keys + on-screen buttons | OPEN QUESTION: no Neural Band API in the wrapper we saw. Fallback: phone taps. |
| `showPhrase` / `showWordCard` / `showImage` / `showViewfinder` / `clearDisplay` | Simulator panel (one item, constrained) | OPEN QUESTION: no display API in the wrapper; needs the official DAT display docs or a custom native module. |
| `speak(text)` / `stopSpeaking()` | `speechSynthesis` at the device volume | Not DAT: phone-side TTS played through the glasses speakers over Bluetooth audio. |
| `playCue(kind)` | Web Audio tones + visual cue badge | Not DAT: same audio route as `speak`. Main feedback channel on Gen 2. |
| `dispose()` | Stops tracks, closes audio, removes key listener | `stopSession` for each open session; remove listeners. |

### Open questions for the DAT adapter

- **How does a web app reach DAT at all?** DAT is a native iOS/Android SDK. Options: a thin
  native companion app bridging to the web app (WebView or local WebSocket), or a native shell.
  Not decided.
- `GlassesAdapter` has no connect / register step, but DAT needs registration via the Meta AI
  app and a camera permission request before streaming.
- Camera frames: a `MediaStream`, raw frames, or photos? This decides how OCR gets its input.
- Display output and Neural Band input on Ray-Ban Display through DAT.
- Real text limits for the 600x600 display (font size, characters per line, lines).
