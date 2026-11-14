# web

The Reading Companion web app: a proof of concept that mirrors the Meta glasses integration.
The browser stands in for the glasses (camera, mic, speakers, a Ray-Ban Display simulator, and
keys for Neural Band gestures). Owner: Alex.

Stack: Vite + React + TypeScript (strict), React Router, Zustand, CSS modules, Vitest,
ESLint + Prettier.

```sh
pnpm install                 # from the repo root (pnpm workspace)
pnpm --filter web dev        # http://localhost:5173  (or `make web`)
pnpm --filter web lint       # eslint + prettier --check + tsc
pnpm --filter web test       # vitest
pnpm --filter web build      # production build into dist/
```

The API should be running for the Settings screen's connection check (`make api` or
`make dev`). Reading and the glasses simulator work without it.

## Layout

| Path                         | What                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/screens/`               | Library, Reader, Word Bank, Settings                                                                                                                                          |
| `src/glasses/`               | The glasses layer. Everything else talks to the glasses only through `GlassesAdapter`                                                                                         |
| `src/glasses/adapter.ts`     | `GlassesAdapter` interface                                                                                                                                                    |
| `src/glasses/web-simulator/` | `WebSimulatorAdapter`: browser camera, mic, speech, cues, gesture keys. **The only place allowed to use `navigator.mediaDevices` or browser audio APIs** (ESLint enforces it) |
| `src/glasses/simulator-ui/`  | Ray-Ban Display simulator panel (600x600, right lens) and its display limits                                                                                                  |
| `src/glasses/meta-dat/`      | `MetaDatAdapter` stub for real glasses (see `docs/glasses-adapter.md`)                                                                                                        |
| `src/reader/`                | Reader state machine (phrase-level), demo phrases                                                                                                                             |
| `src/vision/`                | Hand tracking, OCR, line picking: interfaces only (build order steps 3-4)                                                                                                     |
| `src/live/`                  | Gemini Live client: interface only (build order step 7)                                                                                                                       |
| `src/api/`                   | Typed API client                                                                                                                                                              |
| `src/state/`                 | Zustand stores (reading spacing)                                                                                                                                              |
| `src/ui/`                    | Global styles and spacing CSS variables                                                                                                                                       |

## Trying the glasses simulator

Open **Reader**. Full mapping in [`docs/glasses-adapter.md`](../../docs/glasses-adapter.md).

| Key       | Glasses input               | Does                         |
| --------- | --------------------------- | ---------------------------- |
| `→` / `←` | Neural Band thumb swipe     | Next / previous phrase       |
| `Enter`   | Neural Band index pinch     | Word card for the hard word  |
| `Esc`     | Neural Band middle pinch    | Back / close the viewfinder  |
| `+` / `-` | Neural Band pinch and twist | Volume                       |
| `Space`   | Touchpad tap                | Read the phrase aloud / stop |
| `V`       | Touchpad hold               | Speak a command              |
| `C`       | Capture button              | Photo of the page            |

1. **Start camera**: the glasses' point-of-view camera. The privacy LED on the simulated frame
   lights up, and the display shows a viewfinder to line up the page.
2. **Capture** (`C`): shutter cue, LED flash, the photo shows briefly on the display and under
   the camera. It stays in memory only; nothing is saved or uploaded.
3. **Voice**: press `V` and say "next", "read this", "what does lamp mean", "take a photo" or
   "show the camera". Chrome, Edge and Safari have speech recognition (Chrome and Edge send the
   audio to their speech service); in other browsers, or without a mic, use the typed box.
   "Always listen for hey meta" is a simulator-only option.
4. **Device state**: untick _Worn_ (reading pauses, display off), tick _Folded_ (camera stops),
   untick _Connected_, drag _Battery_ to 0, or tick _Audio-only_ (Ray-Ban Meta Gen 2: no display,
   cues and speech instead). Cues also show as a "♪" badge in case your sound is off.

Word help and answers are canned until the API exists (HACK). Only the demo hard words
(lighthouse, lamp, restless) have definitions.

## Config

The app reads the root `.env` (see `.env.example`). Only `VITE_*` variables reach the browser,
and they are public: never put an API key in one.

- `VITE_API_BASE_URL`: API base URL as seen from the browser (default `http://localhost:8000`).
- `APP_NAME`: injected at build time as the app's display name.

The API must allow the web app's origin: `CORS_ORIGINS` (default `http://localhost:5173`).

## Testing on a phone (HTTPS tunnel)

Browsers only allow the camera and mic in a secure context: `localhost` or HTTPS. A phone on
your network reaching `http://<laptop-ip>:5173` is **not** secure, so the camera will be blocked.
Use an HTTPS tunnel instead, for example `cloudflared tunnel --url http://localhost:5173` or
`ngrok http 5173` (neither is a project dependency; install one yourself). Then:

1. Allow the tunnel's host in Vite: `server.allowedHosts` in `vite.config.ts` (Vite blocks unknown
   hosts by default).
2. The API also needs to be reachable over HTTPS from the phone: tunnel port 8000 too, set
   `VITE_API_BASE_URL` to that URL, and add the web tunnel URL to `CORS_ORIGINS`.
3. Open the web tunnel URL on the phone.

Tunnel URLs are public while running. Don't leave one open.
