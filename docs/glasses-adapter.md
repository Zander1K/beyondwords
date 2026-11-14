# Glasses adapter

All glasses I/O in the web app goes through one interface, `GlassesAdapter`
(`apps/web/src/glasses/adapter.ts`). Today the browser stands in for the glasses
(`WebSimulatorAdapter`). Later a `MetaDatAdapter` will talk to real Meta glasses through the
Meta Wearables Device Access Toolkit (DAT) without the rest of the app changing.

**Rule:** `navigator.mediaDevices` and browser audio APIs (`AudioContext`, `speechSynthesis`, ...)
may only be used inside `apps/web/src/glasses/web-simulator/`. ESLint enforces this.

## Simulator mapping

| Real glasses | Web simulator |
|---|---|
| Glasses camera (aimed at the page) | Browser camera via `getUserMedia` (rear camera preferred) |
| Glasses mic | Browser mic via `getUserMedia` + AudioWorklet, emitted as PCM16 |
| Glasses speakers | `speechSynthesis` for speech, Web Audio tones for cues |
| Ray-Ban Display (600x600, ~20° FOV, right lens) | Display simulator panel (`simulator-ui/`) |
| Neural Band gestures | Keys `←` prev, `→` next, `Enter` select, `Esc` dismiss, plus on-screen buttons |
| Ray-Ban Meta Gen 2 (no display) | "Audio-only mode" toggle (`capabilities.display = false`) |

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
| `startCamera()` | `getUserMedia({ video })` | `startRegistration()` (Meta AI app), `requestPermission("camera")`, then `createSession` → `startSession` → `addStreamToSession`. OPEN QUESTION: DAT renders frames natively and reports frame metadata; it does not return a `MediaStream`. `capturePhoto` is a fallback for page snapshots. |
| `startMic(onAudio)` | `getUserMedia({ audio })` + AudioWorklet → PCM16 at the context rate | Not part of DAT's camera/session API. The glasses mic normally reaches the phone as a Bluetooth audio input. OPEN QUESTION: route and format. |
| `onGesture(handler)` | Keys + on-screen buttons | OPEN QUESTION: no Neural Band API in the wrapper we saw. Fallback: phone taps. |
| `showPhrase` / `showWordCard` / `showImage` / `clearDisplay` | Simulator panel (one item, constrained) | OPEN QUESTION: no display API in the wrapper; needs the official DAT display docs or a custom native module. |
| `speak(text)` | `speechSynthesis` | Not DAT: phone-side TTS played through the glasses speakers over Bluetooth audio. |
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
