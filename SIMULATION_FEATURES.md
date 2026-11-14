# SIMULATION_FEATURES.md — Meta glasses + Neural Band features for the live-camera web simulation

> Purpose: the complete list of Meta Ray-Ban Display / Ray-Ban Meta Gen 2 and Meta Neural Band features our reading companion needs, and exactly how each one must work in the **web simulation built around a live camera view**.
> Companion docs: `CLAUDE.md` (project context), `TASK.md` (mobile-to-web migration). Where this file and `TASK.md` differ on the gesture set or session behaviour, **this file wins** (see section 6, which lists the required `GlassesAdapter` changes).
> Status tags: **[VERIFIED]** = stated in Meta's public docs I read. **[ASSUMPTION]** = our design choice or an unverified detail. **[OPEN]** = must confirm with the Meta mentor before we claim it.

---

## 1. The simulation in one picture

The simulation is a single web page with a **live camera view as the main stage**, not a mockup. The user holds a printed book under the camera. The app tracks their finger on the page, shows what the glasses would display, and speaks the way the glasses would.

```
+--------------------------------------------------------------+------------------------------+
|  LIVE CAMERA VIEW  (main stage)                              |  GLASSES DISPLAY (simulator) |
|  - webcam feed aimed down at the book                        |  600x600 panel, right lens   |
|  - overlay: fingertip dot + hand skeleton (toggle)           |  shows ONLY what the real    |
|  - overlay: OCR line boxes, current line outlined            |  display could show:         |
|  - overlay: current phrase highlight (debug view)            |   - one phrase              |
|  - "camera on" indicator, FPS, latency readout               |   - one word card           |
|                                                              |   - one illustration        |
|                                                              |   - small status icon       |
+--------------------------------------------------------------+------------------------------+
|  CONTROL STRIP: session (Start/Stop/Interrupt/Sleep/Disconnect) | gestures (pad of 6 buttons) |
|                 mode (Display / Audio-only)  | latency + quality knobs | push-to-talk       |
+---------------------------------------------------------------------------------------------+
```

Two views of the same truth:
- **Camera view** = what the glasses camera sees plus our debug overlays (for builders and judges).
- **Glasses display panel** = what the wearer would actually see (strictly limited to real display capabilities).

Everything shown in the glasses panel must be produced by calling the `GlassesAdapter` methods in section 6. The camera view overlays are produced by the vision module and are **not** part of the glasses display.

---

## 2. Feature requirements (what must work in the simulation)

Each requirement has an ID, what the real device does, what the simulation must do, and an acceptance test. Priorities: **P0** demo-critical, **P1** should have, **P2** nice to have.

### 2.1 Camera (live camera view)

| ID | Priority | Requirement |
|---|---|---|
| SIM-CAM-01 | P0 | **Live stream.** Real: head-mounted first-person camera streamed to the paired phone app. Sim: `getUserMedia` video rendered full-stage with a visible "camera on" indicator. Frames reach vision only through `GlassesAdapter.startCamera()`. |
| SIM-CAM-02 | P0 | **Still capture.** Grab a high-quality still on demand (and automatically on page change) for `/pages/analyze`. Show a brief capture flash and thumbnail in the camera view. |
| SIM-CAM-03 | P0 | **Camera permission handling.** Denied or no camera: friendly explanation, retry button, and an "upload a page photo" fallback that feeds the same pipeline. |
| SIM-CAM-04 | P1 | **Quality and latency knobs.** Configurable added latency (0-500 ms), resolution cap (e.g. 480p / 720p / 1080p) and frame-rate cap (e.g. 10 / 15 / 30 fps). Real glasses stream through a phone and will be worse than a webcam; the default profile should be a "glasses-like" preset, with a "best case" preset for debugging. |
| SIM-CAM-05 | P1 | **Camera POV guidance.** On-screen setup hint: aim the camera down at the open book from a reading-distance; page must fill most of the frame. A toggle shows a guide rectangle. |
| SIM-CAM-06 | P2 | **Camera source switch.** Choose between webcams, or open the same app on a phone browser (HTTPS) as the camera while the laptop shows the glasses panel. |

Acceptance: with a book under the camera, the live view shows the page, a still capture produces a page-analysis request, and unplugging or denying the camera shows the fallback instead of a blank screen.

### 2.2 Finger tracking and line picking (vision, on the camera view)

The glasses and Neural Band do **not** report where a fingertip is on a page. Finger-on-line tracking is our own vision feature.

| ID | Priority | Requirement |
|---|---|---|
| SIM-VIS-01 | P0 | **Fingertip detection.** Browser hand tracking (`@mediapipe/tasks-vision` HandLandmarker) on the live stream; index fingertip position drawn as a dot, with optional hand skeleton. Runs off the main thread where possible. |
| SIM-VIS-02 | P0 | **OCR line boxes.** Browser OCR worker (Tesseract.js default) or backend OCR, producing line bounding boxes for the current page; boxes drawn on the camera view, current line outlined. [OPEN: browser vs Nemotron VL OCR, compare in `eval/`] |
| SIM-VIS-03 | P0 | **Nearest-line picking.** Map the fingertip to the line it is under (not on): choose the nearest line above the fingertip with hysteresis to avoid flicker. Output the current line and the current phrase within it. |
| SIM-VIS-04 | P0 | **Hand lost handling.** If no hand is detected for ~700 ms (tunable): hold the last line, play the `lost-hand` cue, show the hand-lost status icon on the glasses panel, and allow manual line/phrase movement with gestures. |
| SIM-VIS-05 | P1 | **Page change detection.** Detect a new page (large change in content) and trigger a fresh still capture and page analysis; keep the cache keyed by image hash. |
| SIM-VIS-06 | P1 | **Stability tuning.** Smoothing, debounce and a "finger resting" dwell time before advancing; configurable in a debug panel. |

Acceptance: sliding a finger under three lines of printed text moves the highlighted phrase to each in order, without flicker; lifting the hand holds the last phrase and plays the cue.

### 2.3 Glasses display (the 600x600 panel)

[VERIFIED] The Ray-Ban Display has a private 600x600 display in the right lens. Apps build screens from a small component set: flexbox layouts, text (heading, body, meta presets), images from a URL (with size and corner radius), buttons, system icons, and short MP4 video. Each update replaces the entire display; partial updates are not supported.

| ID | Priority | Requirement |
|---|---|---|
| SIM-DSP-01 | P0 | **Component-limited rendering.** The panel is built only from: FlexBox, Text (heading/body/meta), Image, Button, Icon. (Video: not needed, do not build.) No free-form HTML from callers. |
| SIM-DSP-02 | P0 | **Whole-screen updates.** Every `show*` call re-renders the full 600x600 scene. No partial DOM patches from outside the panel. The panel exposes an update counter and a "last update" timestamp. |
| SIM-DSP-03 | P0 | **One thing at a time.** Enforce: one phrase, or one word card, or one image, plus an optional small status icon. Reject or truncate anything longer (e.g. phrase over ~12 words, definition over ~25 words) and log a warning. [ASSUMPTION: exact limits are ours; the docs give none] |
| SIM-DSP-04 | P0 | **Phrase highlight.** `showPhrase(text, {emphasis})` renders a short phrase with the emphasised span clearly marked. Updated once per phrase change, never per word. Throttle updates to a configurable max rate (default 5/s). |
| SIM-DSP-05 | P0 | **Word card.** `showWordCard({word, short})`: heading = word, body = short definition (one or two lines), optional buttons "Hear it" and "Picture it" (selected by the `select` gesture). |
| SIM-DSP-06 | P1 | **Illustration.** `showImage(url)`: a single image scaled to the panel with rounded corners; dismissed by `back`. |
| SIM-DSP-07 | P1 | **Status icon.** Small icon + meta text for: listening, thinking, hand lost, offline, reconnecting, page not recognised. |
| SIM-DSP-08 | P1 | **Visual framing.** Right-lens offset and a field-of-view frame around the panel, drawn over a dimmed copy of the camera view so builders can judge placement. Treat black as see-through and keep contrast high. [ASSUMPTION: FOV (~20 degrees) and see-through behaviour are not stated in the docs I read] |
| SIM-DSP-09 | P1 | **Typography controls.** Adjustable letter, word and line spacing and text size, applied to the panel via CSS variables, with an "available on real display?" badge until we confirm. [OPEN: whether letter-spacing and custom fonts are possible on the real display] |
| SIM-DSP-10 | P2 | **Display off in audio-only mode.** Panel greys out and shows "No display (Gen 2 mode)". |

Acceptance: running a finger through a paragraph updates the panel once per phrase, never shows more than one item, and a stress test that sends 50 updates per second is throttled and does not flicker.

### 2.4 Session lifecycle

[VERIFIED] The display session has four states: stopped, starting, started, stopping. The user must explicitly start it; the app gets exclusive display control while it runs; the system can interrupt it (calls, notifications, other priority events); the display dims then sleeps after inactivity and the app must send fresh content on wake; going back from the root screen ends the session; the glasses keep no app state, so the phone app is the source of truth.

| ID | Priority | Requirement |
|---|---|---|
| SIM-SES-01 | P0 | **State machine.** `stopped -> starting -> started -> stopping -> stopped`, shown as a badge in the control strip. Display calls outside `started` are ignored and logged. |
| SIM-SES-02 | P0 | **User-initiated start.** Reading does not begin until the user taps Start (and grants camera/mic). Start takes a simulated 1-2 s. |
| SIM-SES-03 | P0 | **Interrupt button.** Simulates an incoming call or notification: the session goes `started -> stopping -> stopped`, the display clears, audio ducks. On resume, the app restores the reader state. |
| SIM-SES-04 | P0 | **Sleep and wake.** After N seconds of no input (default 30, tunable) the panel dims then blanks. Any gesture wakes it, and the reader **re-sends the current phrase** immediately. |
| SIM-SES-05 | P0 | **Disconnect and reconnect.** A "Disconnect" button simulates losing the glasses: status icon shows offline, reading continues in phone-style fallback if possible; "Reconnect" restores and re-sends state. |
| SIM-SES-06 | P1 | **Back from root ends the session.** `back` on the root (L0) screen stops the session with a confirmation toast. Every other screen's `back` returns one level. |
| SIM-SES-07 | P0 | **Phone is source of truth.** All reader state (book, page, line, phrase, word bank, settings) lives in the web app store, never in the adapter or panel. The adapter can be torn down and recreated without losing the reading position. |

Acceptance: pressing Interrupt, then Resume, returns the user to the same phrase; sleeping and waking redraws it; disconnect/reconnect shows the offline status and recovers.

### 2.5 Neural Band and touchpad input (gestures)

[VERIFIED] The band reads wrist muscle signals (sEMG). Meta's documented gestures: thumb-index pinch to select; thumb-middle pinch to go back; thumb swipes across the side of the index finger for directional scrolling; hold a pinch and move the arm to scroll; pinch-and-rotate for things like volume and zoom; double-tap middle finger on thumb to wake or sleep the glasses. Gestures work with the hand resting at the side or in the lap, and the band gives haptic feedback. The glasses frame also has a capacitive touchpad. [VERIFIED] The system converts touchpad and band input into actions delivered to the app. [OPEN] The public pages I read do not name the exact action events a third-party app receives.

**Our design target:** treat input as six abstract actions, plus system-level wake/sleep.

| Real gesture | Abstract action | Our behaviour | Simulator key / button |
|---|---|---|---|
| Thumb-index pinch | `select` | Open word card for the current word, "Hear it" / "Picture it" on a card, pause or resume read-along | `Enter` |
| Thumb-middle pinch | `back` | Dismiss card or image; on root, end session | `Escape` |
| Thumb swipe right | `right` | Next phrase (manual fallback when finger lost) | `ArrowRight` |
| Thumb swipe left | `left` | Previous phrase | `ArrowLeft` |
| Thumb swipe down | `down` | Next line; scroll a long definition down | `ArrowDown` |
| Thumb swipe up | `up` | Previous line; scroll up | `ArrowUp` |
| Pinch + rotate | `rotate(+/-)` | Read-along speed (only if third-party apps get this; else skip) | `]` / `[` |
| Double tap middle on thumb | system wake/sleep | Simulate as the sleep/wake event, not an app action | "Sleep/Wake" button |
| Frame touchpad tap / swipe | same as select/directional | Alternative input; the main one on Gen 2 | On-screen touchpad buttons |

| ID | Priority | Requirement |
|---|---|---|
| SIM-GST-01 | P0 | **Six-action gesture pad.** On-screen buttons and keyboard keys for `select`, `back`, `left`, `right`, `up`, `down`; visible press feedback and a short haptic-like animation. |
| SIM-GST-02 | P0 | **Gesture log.** Rolling list of gestures received (time, action, source key/button) to debug flows. |
| SIM-GST-03 | P0 | **Gestures only via the adapter.** The reader subscribes with `onGesture`; no component listens to raw key events. |
| SIM-GST-04 | P1 | **Rate limiting and debounce.** Repeated gestures within ~150 ms are coalesced, to mimic real recognition. |
| SIM-GST-05 | P2 | **`rotate` action** behind a feature flag, off unless confirmed. |
| SIM-GST-06 | P2 | **Haptic acknowledgement.** Visual pulse in the control strip standing in for the band's haptic feedback; no real haptics. [OPEN: whether apps can trigger haptics] |

**Design constraint to respect:** the band sits on one wrist. If it is on the hand the reader points with, they cannot pinch while pointing. Rule: gestures are used **between** lines, not mid-line, or the band is worn on the non-pointing hand. Document this in onboarding copy.

**Out of scope:** Neural Handwriting (it is for composing message replies, not reading).

### 2.6 Microphone (voice questions)

| ID | Priority | Requirement |
|---|---|---|
| SIM-MIC-01 | P0 | **Push-to-talk.** Hold a button or press a key (default `Space`), or trigger via `select` while no card is open, to stream mic audio to the backend `/live` bridge. No always-on listening. |
| SIM-MIC-02 | P0 | **Listening state.** While streaming, the glasses panel shows the "listening" status icon and the camera view shows a mic level meter. |
| SIM-MIC-03 | P0 | **Mic permission handling** with a friendly retry, and a typed-question fallback. |
| SIM-MIC-04 | P1 | **Echo handling.** Browser echo cancellation on, plus a "speaker bleed" test mode (play read-along while recording) to confirm the assistant does not answer its own voice. |
| SIM-MIC-05 | P1 | **Context on every question.** Send the current page id, line and phrase with each question so Gemini answers about what is under the finger. Context is injected server-side on page change and reconnect (Gemini tool calls are not guaranteed to fire). |

### 2.7 Speakers (read-along, answers, cues)

| ID | Priority | Requirement |
|---|---|---|
| SIM-SPK-01 | P0 | **Read-along speech.** `speak(text)` for the current phrase when requested or when assist is on; stops immediately on the next phrase change or `back`. |
| SIM-SPK-02 | P0 | **Answer playback.** Gemini Live audio streamed to the speaker; interruptible by push-to-talk. |
| SIM-SPK-03 | P0 | **Audio cues.** `playCue("tick" | "ok" | "lost-hand" | "error")` for the no-display Gen 2 mode and for failures. Distinct, short and quiet. |
| SIM-SPK-04 | P1 | **Output delay knob.** Configurable delay (0-400 ms) to simulate wireless audio latency; the highlight must stay in sync with the voice by compensating. |
| SIM-SPK-05 | P1 | **Volume and speed controls** in settings (and `rotate` if enabled). |

### 2.8 Audio-only mode (Ray-Ban Meta Gen 2)

| ID | Priority | Requirement |
|---|---|---|
| SIM-AUD-01 | P0 | **Mode toggle.** Display / Audio-only. Audio-only sets `capabilities.display = false`: the panel greys out and all feedback becomes speech and cues. |
| SIM-AUD-02 | P1 | **Audio-first flows.** Word help becomes spoken ("aloof: distant and uninterested"), with `select` meaning "say more". Illustrations are described in speech or sent to the phone view instead. |
| SIM-AUD-03 | P1 | **Voice navigation.** Spoken commands "next line", "previous line", "repeat", "what does that mean" map to the same actions as gestures. |

---

## 3. Realism knobs (so the demo does not over-promise)

A webcam is faster and cleaner than the real pipeline. The control strip must include these, with a "Glasses-like" preset and a "Best case" preset:

| Knob | Range | Glasses-like default |
|---|---|---|
| Added camera latency | 0-500 ms | 200 ms |
| Resolution cap | 480p / 720p / 1080p | 720p |
| Frame-rate cap | 10 / 15 / 30 fps | 15 fps |
| Display update rate limit | 1-20 /s | 5 /s |
| Audio output delay | 0-400 ms | 150 ms |
| Sleep timeout | 10-120 s | 30 s |
| Hand-lost timeout | 300-1500 ms | 700 ms |

[ASSUMPTION] All defaults are our estimates, not Meta figures. Replace them with measured values once we test on real hardware.

---

## 4. What we deliberately do not build

- **Eye tracking or gaze input.** Not available on the glasses today.
- **Meta AI's own on-glasses vision.** Not exposed to third-party apps.
- **Highlighting on the paper.** The display cannot draw on the page; the highlight lives only in the glasses panel (and as a debug overlay in the camera view).
- **Video on the display,** and **Neural Handwriting.**
- **Real Neural Band hardware or raw EMG.** Simulated by buttons and keys only.

---

## 5. End-to-end flows the simulation must demonstrate

1. **Start and read.** Start session -> aim camera at a page -> page analysed -> slide a finger under a line -> panel shows the phrase, voice reads along when assist is on.
2. **Hand lost.** Remove the hand -> cue plays, status icon appears, last phrase held -> swipe right/left gestures step through phrases manually -> hand returns, tracking resumes.
3. **Word help.** Select a word (finger dwell or `select`) -> word card on the panel -> `select` on "Hear it" speaks the definition -> `select` on "Picture it" shows an illustration -> `back` dismisses -> word saved to the word bank.
4. **Ask a question.** Hold push-to-talk -> "why did he do that?" -> listening icon -> spoken, grounded answer -> `back` returns to the phrase.
5. **Interruption.** Press Interrupt -> display clears, audio ducks -> Resume -> same phrase restored.
6. **Sleep and wake.** Idle -> panel dims and blanks -> any gesture -> phrase re-sent.
7. **Gen 2 mode.** Switch to Audio-only -> panel greys out -> the same reading flow works through cues and speech.

---

## 6. Required `GlassesAdapter` interface (replaces the one in `TASK.md`)

```ts
type GlassesGesture = "select" | "back" | "left" | "right" | "up" | "down"; // + optional "rotate"

type SessionState = "stopped" | "starting" | "started" | "stopping";

interface GlassesAdapter {
  capabilities: {
    display: boolean;                     // false in Gen 2 / audio-only mode
    displaySize?: { w: 600; h: 600 };
    neuralBand: boolean;
    touchpad: boolean;
  };

  // Session lifecycle
  session: { state: SessionState; start(): Promise<void>; stop(): Promise<void> };
  onSessionEvent(handler: (e: "interrupted" | "resumed" | "slept" | "woke" | "disconnected" | "reconnected") => void): () => void;

  // Input from the glasses
  startCamera(): Promise<MediaStream>;
  captureStill(): Promise<Blob>;
  startMic(onAudio: (pcm: Int16Array) => void): Promise<void>;
  stopMic(): void;
  onGesture(handler: (g: GlassesGesture) => void): () => void;

  // Output to the glasses (each call replaces the whole display scene)
  showPhrase(text: string, opts?: { emphasis?: [number, number] }): void;
  showWordCard(card: { word: string; short: string; actions?: ("hear" | "picture")[] }): void;
  showImage(url: string): void;                        // only if capabilities.display
  showStatus(kind: "listening" | "thinking" | "hand-lost" | "offline" | "reconnecting" | "no-page" | null): void;
  clearDisplay(): void;
  speak(text: string): Promise<void>;
  stopSpeaking(): void;
  playCue(kind: "tick" | "ok" | "lost-hand" | "error"): void;

  dispose(): void;
}
```

Notes:
- Change from `TASK.md`: gestures are now `select/back/left/right/up/down`; the adapter owns the **session lifecycle**; there is `captureStill`, `showStatus`, `stopSpeaking` and `stopMic`.
- `WebSimulatorAdapter` implements everything with browser APIs and the control-strip simulation. `MetaDatAdapter` stays a documented stub, with a comment on each method naming the DAT capability it maps to.
- **Rule unchanged:** `navigator.mediaDevices` and browser audio APIs are only used inside `src/glasses/web-simulator/`.

---

## 7. Web Apps opportunity (check before relying on it)

Meta's Web Apps path runs standard HTML, CSS and JavaScript on the glasses, with access to motion and orientation data, phone GPS, Neural Band input and local storage; you can preview in a browser and deploy to the glasses by URL. Build the glasses panel as its **own route** (`/glasses-display`) that only renders the 600x600 scene and consumes gestures, so it could be loaded as a real Web App later.
[OPEN] Meta's announcement does not mention camera, microphone or audio for Web Apps, so the camera and voice side would probably still need the native DAT path. Confirm with the Meta mentor before promising anything.

---

## 8. Priority summary

**P0 (build first):** live camera view and stills; fingertip detection, OCR line boxes, nearest-line picking, hand-lost handling; component-limited 600x600 panel with whole-screen updates and one-thing-at-a-time rules; phrase highlight and word card; session state machine with start, interrupt, sleep/wake and disconnect; six-gesture pad via the adapter; push-to-talk mic; read-along, answers and cues; audio-only mode; phone-as-source-of-truth.

**P1:** latency and quality knobs; illustration; status icons; typography controls; page-change detection; field-of-view framing; echo test; output-delay knob; voice navigation in audio-only mode.

**P2:** camera source switch (phone as camera), `rotate` gesture, haptic acknowledgement, panel as a standalone Web App route.

---

## 9. Open questions to confirm with the Meta mentor

1. Which exact input actions third-party apps receive from the Neural Band and touchpad.
2. Display field of view, text-length limits, and whether letter-spacing and custom fonts are supported.
3. Whether camera, microphone and audio are available to Web Apps, or only through the native DAT.
4. Whether apps can trigger Neural Band haptics.
5. Real camera frame rate, resolution and latency through the phone, to replace our default knob values.

---

## 10. Sources

- [Display access overview, Meta Wearables Developer docs](https://wearables.developer.meta.com/docs/develop/dat/display-overview/) (components, 600x600, whole-screen updates, session lifecycle, input via touchpad and Neural Band)
- [The wait is over: Build for display glasses starting today, Meta Developers blog](https://developers.meta.com/blog/build-for-display-glasses/) (Web Apps path, native toolkit, EMG gestures)
- [How to use Meta Neural Band, Meta Help Center](https://www.meta.com/help/ai-glasses/764536076119235/) (wake/sleep, scroll, resting-hand use)
- [Hands-on: Meta Ray-Ban Display Glasses & Neural Band, Road to VR](https://www.roadtovr.com/?p=124924) (select, back, directional swipes)
- [Meta Ray-Ban Display hands-on, Tom's Guide](https://www.tomsguide.com/uk/computing/smart-glasses/meta-ray-ban-display-hands-on-this-is-the-future) (pinch-and-rotate)
- [Meta Neural Band product page](https://www.meta.com/ai-glasses/accessories/neural-band/?variant=sand) (haptic feedback)
- [Meta Ray-Ban Display Developer Preview, virtual.reality.news](https://virtual.reality.news/news/meta-ray-ban-display-developer-preview-sdk-paths-and-platform-gaps/) (private right-lens display)
