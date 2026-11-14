# web

The Beyond Words web app: a proof of concept that mirrors the Meta glasses integration.
The browser stands in for the glasses (camera, mic, speakers, a Ray-Ban Display simulator, and
keys for Neural Band gestures). Owner: Alex.

Stack: Vite + React + TypeScript (strict), React Router, Zustand, CSS modules, Vitest,
ESLint + Prettier.

```sh
pnpm install                 # from the repo root (pnpm workspace)
pnpm --filter web dev        # http://localhost:41263  (or `make web`)
pnpm --filter web lint       # eslint + prettier --check + tsc
pnpm --filter web test       # vitest
pnpm --filter web build      # production build into dist/
```

The API should be running for the Settings screen's connection check (`make api` or
`make dev`). Reading and the glasses simulator work without it.

## Layout

| Path                         | What                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/landing/`               | The public landing page (`/`): black and blue, after ALX Studio's design. Its one call to action, "Test this App", opens the access dialog. Copy is in `content.ts`           |
| `src/access/`                | Who may use the app: the username and password check, the session, and `RequireAccess`, which guards every app route                                                          |
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

## Reading modes: Camera and Ebook

The Reader has two modes, switched in the dock (remembered for the browser session):

- **Camera**: the live camera, OCR and hand tracking (the glasses simulation).
- **Ebook**: a streamlined mode with no camera. An embedded four-page story (`src/ebook/`, original
  text written for this app) is read with the **mouse cursor** as the pointer: hover a word to
  highlight its phrase (the glasses display shows it), click it to open its card (pronunciation,
  definition, picture), click it again or press Esc to close. Arrow keys, Enter and Esc work as in
  camera mode. Switching to Ebook starts the simulated glasses session for you.

## Library, books and the word bank

- **In the Reader:** with the camera on, press **📚 Scan book** and hold the book's barcode (or its cover) up.
  A still is taken from the live view and read; the book is added and becomes the current one, and the result
  shows on the glasses display and by the dock.
- **Library** (`/library`): add a book by photographing its barcode, copyright page or cover, or by typing
  the ISBN. Nemotron reads the ISBN off the photo (kept only if its check digit adds up) or, failing that, the
  title and author, which are then searched (Google Books, then Open Library) and stored. New books get a
  setting/era and a spoiler-free blurb added in the background. The book opened last is the **current book**.
- **Context:** the current book's id is sent with every definition, question and picture request, so answers fit
  the book. The Reader shows it as a "📖 Title" pill.
- **Word bank** (`/words`): every word a reader looks up (opens a card on) or asks about by voice is saved with
  the book and the line it was in, counted again on repeat lookups, and logged as a `word_rescued` event.
  Photos are read and never kept; only book metadata is stored, never book text.

## Text reader: Google Cloud Vision, with on-device fallback

The camera is read with **Google Cloud Vision** when it is set up (`GOOGLE_VISION_API_KEY` in the root
`.env`; the Cloud Vision API and billing must be on for the key's project), and with the on-device
PaddleOCR otherwise. Controls > Camera > Text reader switches between them.

- `POST /ocr/page` (a JPEG in, lines and words with positions out) and `GET /ocr/status`. The key stays on the server.
- **Privacy:** with Google Vision, camera frames are sent to Google (through our server) to be read; we do not store them.
  The on-device reader sends nothing anywhere. The Controls sheet says which one is in use.
- **Cost control:** it does not read every frame. It reads when the picture changes a lot (a page turn), at most
  every 2 s and 12 times a minute, and otherwise every 20 s; in between it reuses the last reading
  (`src/vision/cloudPolicy.ts`). The first 1,000 images a month are free.
- If Google fails for any reason the frame is read on-device and Google is left alone for a minute.

## Speech: ElevenLabs, with browser fallback

Read-aloud and ask-by-voice use **ElevenLabs**, through the API (the key stays on the server; set
`ELEVENLABS_API_KEY` in the root `.env`):

- `POST /speech/tts` (text to MP3), `POST /speech/stt` (recorded WAV to text), `GET /speech/voices`.
- **Read-aloud**: "Hear it" speaks with ElevenLabs. If it is not configured, slow or down, the browser's
  own voice takes over for a minute, so reading never stops. Generated phrases are cached.
- **Ask by voice**: the "🎤 Ask" button in the dock. Press to record, press again to stop. The recording is
  transcribed, the brain answers from the page, and the answer shows on the display and is spoken.
- **"Hey Meta"** (the "👂 Hey Meta" toggle, off until you switch it on): saying it starts a question, like on the
  glasses. Listening for the phrase uses the **browser's own speech recognition**, so ElevenLabs hears
  nothing until the phrase has been said: only the recording that follows is sent. After a chime the
  question is recorded and **ends by itself** when you stop talking (about 1.2 s of quiet), or gives up
  after about 6 s of silence (nothing is sent). The Ask button ends the same way.
  Works in Chrome, Edge and Safari; Brave blocks the browser's speech service. In Chrome and Edge the browser's
  recogniser sends its audio to the browser vendor to recognise the phrase.
- Privacy: the text to speak and the recorded question go to ElevenLabs to be processed; nothing is stored here.

## Read aloud (always there)

The dock has a **🔊 Read aloud** toggle (on by default, remembered in this browser; also in Settings > Voice).
With it on, a card is spoken as soon as it has real content: a word's meaning, a spoken-question answer, the
page summary, a book-scan result. Placeholders ("Looking it up…") are never spoken, a card is not repeated while
it stays open, and closing and reopening it reads it again. "Hear it" still reads a card on request with the
toggle off. Phrases themselves are not read automatically (the reader keeps control; only cards are read).

Browsers refuse to play sound until the page has been clicked, and a hand gesture or "Hey Meta" does not count.
Blocked speech is no longer lost: the app shows "Your browser is blocking sound. Click anywhere…", remembers what
was to be said, and speaks it on the next click. If neither ElevenLabs nor the browser has a voice, it says so.

## Voices

Read-aloud uses the browser's own speech voices (`speechSynthesis`). The voice library
(`src/glasses/web-simulator/voices.ts`) drops novelty voices and ranks the rest by how natural they
tend to sound, judged from the name (neural, "Natural", Premium/Enhanced, Google, Siri...), so the
default is the best one available, not the engine's often-robotic default. Settings > Voice lets you
pick a voice, preview it, and set the speed; the choice is kept in this browser. Which voices exist
depends on your browser and OS (Edge's online "Natural" voices and Chrome's Google voices are the
most lifelike; on macOS, add Premium/Enhanced voices in System Settings > Accessibility > Spoken
Content).

## Landing page and access

`/` is a public landing page. Its one call to action, **Test this App**, asks for a **username**
(2 to 32 characters) and the **access password**, then opens the app (Reader). The app's own
routes (`/library`, `/reader`, `/words`, `/settings`) send anyone who has not signed in back to
the landing page, and bring them to where they were headed once they have. The sign-in lasts
for the browser tab (`sessionStorage`); **Sign out** is in the app header.

**This is a courtesy gate for a demo, not security.** The check runs in the browser, so anyone
who reads the page's code can find it, and the SHA-256 digest of the password in
`src/access/access.ts` can be guessed offline. The repository holds only that digest, not the
password. To change the password: `printf '%s' 'the new password' | shasum -a 256` and paste the
hex into `ACCESS_PASSWORD_SHA256`. If the app ever needs real protection, the check has to move
to the API (FastAPI), which must then refuse unauthenticated calls.

The landing page uses the Geist font from Google Fonts (a `<link>` in `index.html`); without a
connection it falls back to the system font. The app's name comes from `APP_NAME` in `.env`
(read when the dev server starts, so restart it after changing it).

## Trying the glasses simulator

The camera view is the glasses' eyes: what is read, where you are and your gestures all come
from it. **Reader** is a single view: the live camera fills it (**Fullscreen** in the bottom
bar; on iPhone it fills the screen instead), the simulated glasses display floats on top in the
right-lens position, status runs along the top, and **Controls** opens a sheet with the page
text, overlay options and the glasses simulator (gesture pad and log, system events, display
stats, audio-only mode). Sign in from the landing page, then open **Reader**:

1. **Start camera** and aim it down at an open book so the page fills most of the frame. The
   page is read **continuously**, with no scan button: PaddleOCR reads frame after frame in a
   Web Worker (a full read of a page takes a few seconds, then about a second or two while the page is held still; slower on phones), and each read is merged into the page,
   so lines your hand covers keep their last reading and a turned page starts over. Boxes are
   drawn over the view; a **mock** page analysis splits lines into phrases and hard words.
   Each line is found from the text detector's map and flattened along its own curve before it
   is read, so curled and tilted pages and open books (two pages, split at the gutter) read
   correctly. Lines that look the same as in the last frame keep their reading, so a page held
   still is cheap to keep reading. Camera frames are never saved or uploaded.
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

The first camera start downloads the hand model (~7.8 MB); the first read downloads the OCR
models (PP-OCRv6 small, ~31 MB) and ONNX Runtime (~7 MB compressed), This needs an internet connection (HACK: vendor them for an offline demo). Word help definitions are mock.

## Config

The app reads the root `.env` (see `.env.example`). Only `VITE_*` variables reach the browser,
and they are public: never put an API key in one.

- `VITE_API_BASE_URL`: API base URL as seen from the browser. Default `/api`, which the dev
  server forwards to FastAPI (`API_PROXY_TARGET`, default `http://localhost:38417`).
- `APP_NAME`: injected at build time as the app's display name.

Through the `/api` proxy the browser sees one origin, so CORS is not involved. If you point
`VITE_API_BASE_URL` straight at the API, it must allow the web app's origin: `CORS_ORIGINS`
(default `http://localhost:41263`).

## Testing on a phone (same Wi-Fi)

Phones only allow the camera and mic over HTTPS, so LAN mode serves a self-signed certificate:

```sh
make api        # FastAPI on this machine (or make dev)
make web-lan    # prints https://<your-ip>:41263
```

1. Connect the phone to the **same Wi-Fi** as this computer.
2. Open the printed `https://<your-ip>:41263` address. The browser warns that the certificate is
   not trusted (it is self-signed): choose _Advanced_ → _Proceed_ (Chrome) or _Show Details_ →
   _visit this website_ (Safari). This is needed once per browser.
3. Start the camera and allow access. The rear camera is used.

API calls go to `/api` on the same address and the dev server forwards them to FastAPI, so the
phone never needs to reach port 38417. If the page does not load, check the computer's firewall
allows incoming connections on port 41263.

## Testing from outside your network (HTTPS tunnel)

Browsers only allow the camera and mic in a secure context: `localhost` or HTTPS. A phone on
your network reaching `http://<laptop-ip>:41263` is **not** secure, so the camera will be blocked.
Use an HTTPS tunnel instead, for example `cloudflared tunnel --url http://localhost:41263` or
`ngrok http 41263` (neither is a project dependency; install one yourself). Then:

1. Allow the tunnel's host in Vite: `server.allowedHosts` in `vite.config.ts` (Vite blocks unknown
   hosts by default).
2. The API also needs to be reachable over HTTPS from the phone: tunnel port 38417 too, set
   `VITE_API_BASE_URL` to that URL, and add the web tunnel URL to `CORS_ORIGINS`.
3. Open the web tunnel URL on the phone.

Tunnel URLs are public while running. Don't leave one open.
