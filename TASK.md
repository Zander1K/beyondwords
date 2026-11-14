# TASK.md — Migrate the frontend from React Native (mobile) to a web app

> Scope: this task only. Read `CLAUDE.md` for project context, but where it describes the frontend as a mobile app (Expo / React Native / `apps/mobile`), **this file overrides it.** The last step of this task updates `CLAUDE.md` so the two agree.

## 1. Why

We are replacing the mobile app with a **web app proof of concept that mirrors the Meta glasses integration**. The browser stands in for the glasses:

- Browser camera = glasses camera (aimed at the book page)
- Browser mic and speaker = glasses mic and speakers
- A **display simulator panel** = Ray-Ban Display (600x600, ~20 degree FOV, right lens only)
- Keyboard keys and on-screen buttons = Neural Band gestures
- An **audio-only mode** = Ray-Ban Meta Gen 2 (no display)

All glasses I/O must go through one interface, `GlassesAdapter`, so a real `MetaDatAdapter` can replace the simulator later without rewriting the app.

## 2. Current state (verify first, do not assume)

The repo was scaffolded from the original `CLAUDE.md`, so expect:
- `apps/mobile/` with Expo + React Native + TypeScript, and modules `src/glasses`, `src/vision`, `src/reader`, `src/live`, `src/api`, `src/state`, `src/ui`
- `apps/api/` (FastAPI), `db/`, `infra/`, `eval/`, `packages/contracts/`
- Makefile, docker-compose, `.env.example`, READMEs, possibly a pnpm workspace and CI config referencing `apps/mobile`

**Before changing anything:** inspect the repo, list what actually exists in `apps/mobile`, and write a short migration plan (what gets ported, what gets dropped, what gets rewritten). Show me the plan, then proceed unless something in it is risky or unclear.

## 3. Goal

Replace `apps/mobile` with `apps/web` (React + TypeScript + Vite) that boots on `localhost`, has the `GlassesAdapter` interface, a working `WebSimulatorAdapter`, and the 600x600 display simulator panel. Everything that was working in the backend and shared packages keeps working.

## 4. Do

### 4.1 Create `apps/web`
- Vite + React + TypeScript (strict). ESLint + Prettier matching the repo's existing config where possible. Vitest for unit tests.
- Routing: React Router (or the lightest equivalent) with placeholder screens: Library, Reader, Word Bank, Settings.
- Styling: Tailwind or CSS modules (pick one, keep it minimal). Spacing-first typography: clean sans font, adjustable letter, word and line spacing exposed as CSS variables. **No dyslexia-specific fonts.**
- State: Zustand (port the existing store shape from `apps/mobile/src/state` if one exists).
- Env: `VITE_API_BASE_URL` only (public, non-secret). Never put API keys in the web bundle.
- Dev server on `localhost` (camera needs a secure context). Add a note in the README on using an HTTPS tunnel to test on a phone.

### 4.2 Port what is platform-independent
Move or adapt, do not rewrite from scratch, anything already in `apps/mobile` that is plain TypeScript:
- Typed API client in `src/api` (regenerate from `packages/contracts` if it was generated)
- Zustand state and types
- Reader logic: highlight state machine, phrase pacing (strip any React Native imports)
- Any shared utilities or constants (`APP_NAME`, etc.)

Rewrite or drop anything that imports `react-native`, `expo-*`, `expo-router`, native modules, or Meta DAT wrappers. List dropped items in the summary.

### 4.3 Build the glasses layer in `apps/web/src/glasses/`
- `adapter.ts`: the `GlassesAdapter` interface:

```ts
interface GlassesAdapter {
  capabilities: { display: boolean; displaySize?: { w: number; h: number }; neuralBand: boolean };

  // Input from the glasses
  startCamera(): Promise<MediaStream>;                               // book page frames
  startMic(onAudio: (pcm: Int16Array) => void): Promise<void>;
  onGesture(handler: (g: "next" | "prev" | "select" | "dismiss") => void): () => void;

  // Output to the glasses
  showPhrase(text: string, opts?: { emphasis?: [number, number] }): void;
  showWordCard(card: { word: string; short: string }): void;
  showImage(url: string): void;                 // only if capabilities.display
  clearDisplay(): void;
  speak(text: string): Promise<void>;           // read-along / answers
  playCue(kind: "tick" | "ok" | "lost-hand" | "error"): void;   // for the no-display Gen 2

  dispose(): void;
}
```

- `web-simulator/WebSimulatorAdapter`: camera and mic via `getUserMedia`, speaker via Web Audio / `speechSynthesis`, gestures from keys (`ArrowRight`, `ArrowLeft`, `Enter`, `Escape`) plus on-screen buttons, display output rendered into the simulator panel.
- `simulator-ui/`: the 600x600 display panel with a ~20 degree FOV frame and right-lens offset. It must enforce the real display constraints itself: **one** short phrase, word card or image at a time, no scrolling paragraphs. Include a toggle for **audio-only mode** (sets `display: false`).
- `meta-dat/MetaDatAdapter`: a stub that throws "not implemented". In comments, list which Meta DAT capability each method would map to. Also write this mapping in `docs/glasses-adapter.md`. Do not install any Meta or Expo packages.
- **Rule:** `navigator.mediaDevices` and browser audio APIs may only be used inside `src/glasses/web-simulator/`. Everything else goes through the adapter.

### 4.4 Vision and live modules (placeholders only)
- `src/vision/`: keep or create placeholder modules for hand tracking (`@mediapipe/tasks-vision` HandLandmarker), OCR worker (Tesseract.js default) and nearest-line picking, each with a `TODO(alex)` and the intended interface. **Do not implement tracking or OCR in this task** unless working code already exists to port.
- `src/live/`: placeholder for the Gemini Live WebSocket client and mic streaming (AudioWorklet), talking to the backend `/live` endpoint. TODO only.

### 4.5 Repo plumbing
- Remove `apps/mobile` entirely (git history keeps it). Delete leftover Expo and React Native config, dependencies, scripts and lockfile entries.
- Update the pnpm workspace config, root `package.json` scripts, `Makefile` (`make dev` and `make test` should reference `apps/web` and Vitest), docker-compose (only if it referenced the mobile app), `.env.example` (add `VITE_API_BASE_URL`, `CORS_ORIGINS`; remove mobile-only vars), CI config, and `.gitignore`.
- API: make sure CORS allows the web dev origin (`http://localhost:5173` by default) via `CORS_ORIGINS`, and that the `/live` WebSocket accepts connections from it.
- `packages/contracts`: keep generating OpenAPI and TS types; update the generation target path if it pointed at `apps/mobile`.
- Update READMEs (root and `apps/web`) and `docs/architecture.md`.

### 4.6 Update `CLAUDE.md`
Make `CLAUDE.md` agree with the new direction, with minimal edits:
- Section 1: add the "web app proof of concept that mirrors the glasses" decision and the simulator mapping above.
- Stack table: replace React Native + Expo with React + Vite; hand tracking runs in the browser; real DAT moves to a later `MetaDatAdapter`.
- Repo layout: `apps/mobile` becomes `apps/web` with the `glasses/` structure above.
- Ownership table: Alex owns `apps/web/`.
- Add the adapter rule from 4.3, and update the build order and commands (`vitest`, `pnpm --filter web dev`).
- Do not change the product rules, data model, API surface, privacy rules or brain/Gemini sections except where they mention mobile.

## 5. Don't

- Do not implement OCR, hand tracking, Gemini Live, word help, illustrations or progress features. Those are later build-order steps.
- Do not touch `apps/api/app/brain/`, `apps/api/app/gemini/` or `apps/api/app/db/` beyond the CORS and `/live` origin fix, and never change schemas or API contracts without saying so.
- Do not add dependencies beyond what section 4 needs (Vite, React, React Router, Zustand, Tailwind or CSS modules, Vitest, `@mediapipe/tasks-vision`, `tesseract.js` if you add the placeholders' types). Explain each addition in the summary.
- Do not invent details for anything uncertain. Leave a marked `TODO` or `OPEN QUESTION:` and list it in the summary.
- Do not commit secrets, real user images or copyrighted book text.

## 6. Acceptance criteria

1. `make dev` starts the API and MariaDB, and `pnpm --filter web dev` serves the web app on `localhost`.
2. The web app loads with the four placeholder screens and no console errors.
3. In the Reader screen, the **display simulator** shows a hard-coded test phrase; the arrow keys, Enter and Escape change what it shows (via `onGesture` and `showPhrase`); the audio-only toggle blanks the display and plays cues instead.
4. The camera stream shows in the app through `WebSimulatorAdapter.startCamera()`, with a clear "camera on" indicator and a friendly message if permission is denied.
5. `GET /health` still works and the web app can call it from the browser (CORS OK).
6. `make lint` and `make test` pass. There is a Vitest unit test for the simulator's display-constraint enforcement and one for the adapter's gesture mapping.
7. `grep -ri "expo\|react-native\|apps/mobile" .` (excluding `node_modules` and git history) returns nothing, except deliberate mentions in docs explaining the migration.
8. `CLAUDE.md` reflects the web direction (4.6).

## 7. Final report (required)

When finished, give me:
- the migration plan as executed, with what was ported, dropped and rewritten
- how to run it and test acceptance criteria 1-8, and which you could not verify
- every added dependency with a one-line reason
- every `OPEN QUESTION` and `HACK` you left
- a suggested next task (build order: page capture, OCR and `/pages/analyze` slice)

Then stop and wait for me.