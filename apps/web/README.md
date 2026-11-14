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
from it. **Reader** is a single view: the live camera fills it (**Fullscreen** in the bottom
bar; on iPhone it fills the screen instead), the simulated glasses display floats on top in the
right-lens position, status runs along the top, and **Controls** opens a sheet with the page
text, overlay options and the glasses simulator (gesture pad and log, system events, display
stats, audio-only mode). Open **Reader**:

1. **Start camera** and aim it down at an open book so the page fills most of the frame. A page
   still is taken once the camera settles and your hand is out of view (or press **Scan
   page**): PaddleOCR reads the lines and words in a Web Worker (boxes are drawn over the view)
   and a **mock** page analysis splits them into phrases and hard words. Tilted or curled pages
   are flattened first when the quick read is unsure (slower, ~2 s or more). No camera?
   **Upload a page photo** instead. Nothing is saved or uploaded.
2. **Start reading** (the glasses display session needs your go-ahead).
3. **Point** just under a word: the exact word above your fingertip is highlighted on the
   glasses (inside its phrase) and outlined on the camera view; a pinch (`select`) opens that
   word's card (definitions are mock). Lift your hand away for 0.7 s: the last line is held, the
   lost-hand cue plays and the panel shows the hand-lost icon.
4. **Gestures from the camera** (the simulated Neural Band):

   | Hand                         | Action                 |
   | ---------------------------- | ---------------------- |
   | Thumb + index pinch          | select (word card)     |
   | Thumb + middle pinch         | back                   |
   | Open-palm swipe left / right | previous / next phrase |
   | Open-palm swipe up / down    | previous / next line   |

   The fallback keys are `Enter`, `Esc` and the arrow keys, plus the on-screen pad (in
   **Controls**). Every gesture shows in the gesture log with its source. In native fullscreen
   the browser uses `Esc` to exit fullscreen, so use a middle pinch for back there. If swipes go the wrong way (camera facing you),
   tick **Mirror swipes**.

5. **System events** in **Controls**: Interrupt/Resume, Sleep/Wake, Disconnect/Reconnect,
   Recreate adapter. **Stress test** checks the 5 updates/s display limit.

The first camera start downloads the hand model (~7.8 MB); the first scan downloads the OCR
models (~6 MB) and ONNX Runtime (~7 MB compressed), plus ~30 MB more the first time a page
needs flattening. This needs an internet connection (HACK: vendor them for an offline demo). Word help definitions are mock.

## Config

The app reads the root `.env` (see `.env.example`). Only `VITE_*` variables reach the browser,
and they are public: never put an API key in one.

- `VITE_API_BASE_URL`: API base URL as seen from the browser. Default `/api`, which the dev
  server forwards to FastAPI (`API_PROXY_TARGET`, default `http://localhost:8000`).
- `APP_NAME`: injected at build time as the app's display name.

Through the `/api` proxy the browser sees one origin, so CORS is not involved. If you point
`VITE_API_BASE_URL` straight at the API, it must allow the web app's origin: `CORS_ORIGINS`
(default `http://localhost:5173`).

## Testing on a phone (same Wi-Fi)

Phones only allow the camera and mic over HTTPS, so LAN mode serves a self-signed certificate:

```sh
make api        # FastAPI on this machine (or make dev)
make web-lan    # prints https://<your-ip>:5173
```

1. Connect the phone to the **same Wi-Fi** as this computer.
2. Open the printed `https://<your-ip>:5173` address. The browser warns that the certificate is
   not trusted (it is self-signed): choose _Advanced_ → _Proceed_ (Chrome) or _Show Details_ →
   _visit this website_ (Safari). This is needed once per browser.
3. Start the camera and allow access. The rear camera is used.

API calls go to `/api` on the same address and the dev server forwards them to FastAPI, so the
phone never needs to reach port 8000. If the page does not load, check the computer's firewall
allows incoming connections on port 5173.

## Testing from outside your network (HTTPS tunnel)

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
