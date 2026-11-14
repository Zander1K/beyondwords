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

The camera view is the glasses' eyes: what is read, where you are and your gestures all come
from it. Open **Reader**:

1. **Start camera** and aim it down at an open book so the page fills most of the frame. A page
   still is taken after ~1.5 s (or press **Scan page**): Tesseract.js reads the lines (boxes are
   drawn over the view) and a **mock** page analysis splits them into phrases and hard words.
   No camera? **Upload a page photo** instead. Nothing is saved or uploaded.
2. **Start reading** (the glasses display session needs your go-ahead).
3. **Point** just under a line: the line and phrase under your fingertip are highlighted on the
   glasses panel and the camera view. Lift your hand away for 0.7 s: the last line is held, the
   lost-hand cue plays and the panel shows the hand-lost icon.
4. **Gestures from the camera** (the simulated Neural Band):

   | Hand                         | Action                 |
   | ---------------------------- | ---------------------- |
   | Thumb + index pinch          | select (word card)     |
   | Thumb + middle pinch         | back                   |
   | Open-palm swipe left / right | previous / next phrase |
   | Open-palm swipe up / down    | previous / next line   |

   The fallback keys are `Enter`, `Esc` and the arrow keys, plus the on-screen pad. Every gesture
   shows in the gesture log with its source. If swipes go the wrong way (camera facing you),
   tick **Mirror swipes**.

5. **System events** in the panel: Interrupt/Resume, Sleep/Wake, Disconnect/Reconnect,
   Recreate adapter. **Stress test** checks the 5 updates/s display limit.

The first camera start downloads the hand model (~7.8 MB) and the OCR model; this needs an
internet connection (HACK: vendor them for an offline demo). Word help definitions are mock.

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
