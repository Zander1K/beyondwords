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

Open **Reader**:

- `←` / `→` move between phrases, `Enter` shows the word card, `Esc` dismisses. The on-screen
  buttons under the display do the same (they stand in for Neural Band gestures).
- **Audio-only mode** simulates Ray-Ban Meta Gen 2: the display goes blank, and gestures play
  cues (also shown as a "♪" badge, in case your sound is off).
- **Start camera** asks for camera permission and shows the feed with a "Camera on" indicator.

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
