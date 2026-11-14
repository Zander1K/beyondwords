# CLAUDE.md — Smart Glasses Reading Companion (monorepo)

> Working name: **Reading Companion** (final name TBD; keep it in one config constant, `APP_NAME`, so renaming is a one-line change).
> Source of truth for product behaviour: the "Smart Glasses Reading Companion — Application SOP" doc. If this file and the SOP disagree, the SOP wins. Flag the conflict instead of guessing.

## 1. What we are building

A smart-glasses add-on for Meta AI glasses that helps people with dyslexia (and anyone who finds reading effortful) read **printed books**, with everyday documents as a secondary use. Focus: education and guided learning.

Core idea: the problem is **decoding, not comprehension**. The app reads *with* the user (not *for* them), keeps their place, explains hard words in context, and gradually fades its support as the reader gets stronger.

Built for the Junction 2026 hackathon (Meta "AI Glasses for Everyone, Everyday" challenge, plus NVIDIA Nemotron and Google Gemini tracks). Prioritise a working, demoable vertical slice over completeness.

### Decision: web app proof of concept that mirrors the glasses
The frontend is a **web app** (`apps/web`), not a mobile app. (It replaced an earlier React Native / Expo app in `apps/mobile`; git history keeps it.) The browser stands in for the glasses:

| Glasses | Web simulator |
|---|---|
| Glasses camera (aimed at the page) | Browser camera |
| Glasses mic and speakers | Browser mic and speaker |
| Ray-Ban Display (600x600, ~20 degree FOV, right lens only) | Display simulator panel |
| Neural Band gestures, temple touchpad, capture button | Keys and on-screen buttons (mapping in `docs/glasses-adapter.md`) |
| Privacy LED, worn / folded / connected / battery | Simulated device state |
| Voice | Browser speech recognition (push-to-talk) with a typed fallback |
| Ray-Ban Meta Gen 2 (no display) | Audio-only mode |

Only glasses features relevant to reading are simulated; add others when a use case needs them.

All glasses I/O goes through one interface, `GlassesAdapter`, so a real `MetaDatAdapter` can replace the simulator later without rewriting the app. See `docs/glasses-adapter.md`.

### Core user loop
1. User opens a book and points the glasses camera at a page.
2. The app captures the frame (browser today, real glasses via `MetaDatAdapter` later), runs OCR + hand tracking, backend analyses the page.
3. User runs a finger under a line; the current phrase is highlighted on the glasses display and read aloud (read-along).
4. User asks questions by voice ("what does *aloof* mean here?", "why did he do that?"); Gemini Live answers, grounded by the backend brain.
5. Progress and a personal word bank are saved to MariaDB.

## 2. Team and ownership

| Person | Owns | Primary directories |
|---|---|---|
| Matthew | Brain of the app (NVIDIA Nemotron) | `apps/api/app/brain/` |
| Alex | Frontend (web app, glasses adapter), Meta Wearables Device Access Toolkit (DAT) | `apps/web/` |
| Mick Ola | Architecture, MariaDB, Gemini integration | `apps/api/app/db/`, `apps/api/app/gemini/`, `infra/`, `db/` |

Cross-boundary changes (API contracts, schema, shared types) need a note in the PR description tagging the other owner. Do not silently change a contract.

## 3. Stack (fixed — do not substitute without asking)

| Layer | Choice |
|---|---|
| Glasses | Meta Ray-Ban Display (full) and Ray-Ban Meta Gen 2 (audio-first) via Meta Wearables DAT 1.0 |
| Web app | React + Vite (TypeScript, strict), React Router, Zustand, CSS modules, Vitest. The browser simulates the glasses via `WebSimulatorAdapter`; real DAT moves to a later `MetaDatAdapter` |
| Hand tracking / OCR | In the browser: MediaPipe HandLandmarker (`@mediapipe/tasks-vision`), Tesseract.js in a worker (planned) |
| API / middleware | FastAPI (Python 3.11+), async, Pydantic v2 |
| Database | MariaDB (SQLAlchemy 2.x async + Alembic migrations) |
| Brain | NVIDIA Nemotron 3.5 Super VL, served with vLLM on **Verda**. NVIDIA Build is the fallback (free tier ~40 req/min/key) |
| Voice / conversation | Gemini Live, which calls our `ask_brain()` tool |
| Illustrations | Gemini image generation via the `illustrate()` tool |
| Model layer | Swappable via `brain/llm.py` so Meta Muse Spark can replace Gemini in production |

## 4. Repository layout (scaffold this)

```
.
├── CLAUDE.md
├── README.md
├── .env.example
├── docker-compose.yml            # api + mariadb for local dev
├── Makefile                      # make dev, make test, make migrate, make lint
├── docs/
│   ├── SOP.md                    # export of the SOP doc (reference only)
│   ├── architecture.md
│   └── api-contracts.md          # human-readable mirror of packages/contracts
├── packages/
│   └── contracts/                # SHARED source of truth for API types
│       ├── openapi.json          # generated from FastAPI, committed
│       └── ts/                   # generated TypeScript types for the web app
├── apps/
│   ├── web/                      # React + Vite web app that mirrors the glasses (Alex)
│   │   ├── vite.config.ts
│   │   ├── package.json
│   │   └── src/
│   │       ├── screens/          # Library, Reader, Word Bank, Settings (React Router)
│   │       ├── glasses/          # ALL glasses I/O
│   │       │   ├── adapter.ts    # GlassesAdapter interface
│   │       │   ├── web-simulator/   # WebSimulatorAdapter: browser camera, mic, speaker, gesture keys
│   │       │   ├── simulator-ui/    # 600x600 Ray-Ban Display simulator panel, audio-only toggle
│   │       │   └── meta-dat/        # MetaDatAdapter stub (real glasses via DAT, later)
│   │       ├── vision/           # hand tracking (MediaPipe), OCR (Tesseract.js), line picking
│   │       ├── reader/           # highlight state machine, phrase pacing, read-along
│   │       ├── live/             # Gemini Live session + WebSocket client
│   │       ├── api/              # typed client generated from packages/contracts
│   │       ├── state/            # app state (Zustand)
│   │       └── ui/               # components, spacing-first typography
│   └── api/                      # FastAPI service (Matthew + Mick)
│       ├── pyproject.toml
│       ├── Dockerfile
│       ├── alembic.ini
│       └── app/
│           ├── main.py
│           ├── config.py         # settings from env, APP_NAME, feature flags
│           ├── routers/          # books.py, pages.py, words.py, progress.py, live.py (WS)
│           ├── schemas/          # Pydantic models (page JSON, requests, responses)
│           ├── brain/            # Matthew
│           │   ├── llm.py        # swappable model interface (Nemotron, Gemini, Muse Spark stub)
│           │   ├── nemotron.py   # Verda/vLLM + NVIDIA Build client
│           │   ├── page_analyzer.py   # reading order, phrases, hard words -> page JSON
│           │   ├── agent.py      # agent loop with tools
│           │   ├── tools/        # get_book_context, define_word, explain_passage, illustrate, get_progress ...
│           │   ├── grounding.py  # check answers against page/book context
│           │   └── prompts/      # versioned prompt files
│           ├── gemini/           # Mick: Live session bridge, ask_brain() tool, image generation
│           ├── db/               # Mick: models.py, session.py, repositories/
│           └── tests/
├── db/
│   ├── migrations/               # Alembic versions
│   └── seed/                     # sample books metadata, demo user
├── infra/
│   ├── verda/                    # vLLM launch config, serving notes, health check
│   └── scripts/
└── eval/
    ├── pages/                    # test page photos (see section 9)
    └── run_eval.py               # page-analysis + grounding checks
```

Use a workspace tool for JS (pnpm workspaces) and keep Python deps in `apps/api` with `uv` or `pip-tools`. Do not add a monorepo build system (Nx, Turborepo) unless asked; a Makefile is enough for a hackathon.

## 5. Data model (MariaDB)

Tables: `users`, `books`, `user_books`, `pages`, `lines`, `word_bank`, `reading_events`.

- `books`: **metadata only** (title, author, ISBN, edition, language, level). **Never store book text.** The library exists so the brain knows which book a word appears in and can give contextual help, and so progress can be tracked.
- `pages` / `lines`: per-user captured page analysis (line boxes, phrase splits, hard-word flags), keyed to `user_books`.
- `word_bank`: words the user struggled with or asked about, with the book and context sentence where they met it, plus review state.
- `reading_events`: append-only log (line completed, word looked up, question asked, assist faded) used for progression and fading support.
- All schema changes go through Alembic migrations. Never edit the DB by hand. Seed data lives in `db/seed/`.

## 6. API surface (v1, keep stable; contracts live in `packages/contracts`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/books/identify` | Identify a book from cover / title page / ISBN; returns book id + metadata |
| POST | `/pages/analyze` | Image (+ OCR line boxes) -> page JSON (reading order, phrases, hard words) |
| POST | `/brain/ask` | Question + page/book context -> grounded answer (used by `ask_brain()`) |
| POST | `/words/define` | Contextual definition + simple breakdown (syllables / morphemes) |
| POST | `/illustrate` | Prompt from passage -> image (Gemini) |
| POST | `/progress` | Write reading events, update word bank |
| GET | `/progress/{user_book_id}` | Progress summary |
| WS | `/live` | Gemini Live session bridge |

The paths marked above beyond `/books/identify`, `/progress` and `/live` are proposed; confirm against SOP section 5 and adjust. The **page JSON schema** is defined in SOP section 8.1. Implement it exactly as Pydantic models in `app/schemas/page.py`, generate OpenAPI, and generate TS types from it so the web app and backend can never drift.

## 7. How the pieces cooperate

- **Finger tracking runs in the browser**, not on the glasses and not in the cloud: MediaPipe HandLandmarker finds the fingertip; OCR line boxes pick the nearest line; the reader module turns that into the current phrase.
- **Glasses adapter rule:** all glasses I/O goes through `GlassesAdapter`. `navigator.mediaDevices` and browser audio APIs may only be used inside `apps/web/src/glasses/web-simulator/` (ESLint enforces it).
- **Nemotron handles understanding**: reading order, phrase boundaries, hard words, document reasoning, grounding checks, conversation plans.
- **Gemini Live is the voice**, and calls `ask_brain()`. Gemini tool calls are not guaranteed to fire (reported ~60-70%) and sessions last roughly 10-15 minutes, so:
  - **Inject page and book context server-side** at session start and on every page change; never rely on the tool call to get context.
  - Auto-reconnect and restore context when a session expires.
- **Highlight shows on the glasses display only**, not on the paper. Ray-Ban Display: 600x600, ~20 degree FOV, right lens. Ray-Ban Meta Gen 2 has no display, so degrade to audio cues.
- No eye tracking exists. Do not design around gaze.
- Meta AI's own on-glasses vision is **not** exposed to apps. Our app uses the camera feed via DAT (in the web proof of concept, the browser camera stands in).

## 8. Product and design rules (non-negotiable)

- **Spacing, not dyslexia fonts.** OpenDyslexic showed no measurable benefit. Use a clean sans font with generous letter, word and line spacing; make it adjustable.
- **Phrase-level synced highlighting**, not word-by-word flicker.
- **Read along, do not read for.** Default is silent support the user pulls on; read-aloud is on request or fading assist.
- **Fade support** as the user improves (track in `reading_events`; surface in settings so the user is in control).
- **Never claim to cure or treat dyslexia.** Copy says "comfortable reading", not therapy.
- Keep on-glasses text minimal: a phrase, a word, a short definition.
- Latency matters more than polish: target page analysis under ~2 s and highlight update under ~150 ms after the finger moves (confirm numbers against SOP section 9).

## 9. Reliability and failure handling

Implement graceful degradation, never a dead end:
- Brain unavailable or slow -> fall back to local OCR + plain phrase splitting; show a subtle status, keep reading working.
- Hand tracking lost -> keep last line, offer a manual next-line gesture (Neural Band or tap).
- Rate limit (NVIDIA Build ~40 req/min/key) -> client-side queue, batching, cache page analyses by image hash.
- Gemini Live session expires -> reconnect and re-inject context.
- Always log failures with a request id; never crash the reading session.

Evaluation: `eval/pages/` holds a small set of real photos (curved book spines, shadows, glare, two-column, small print, children's books). `eval/run_eval.py` reports OCR line accuracy, reading-order accuracy and grounding pass rate. Run it before changing prompts or models.

## 10. Privacy

- Camera frames and audio are processed to serve the request; do not persist raw images or audio unless a feature explicitly needs it and the user has opted in.
- Store derived data only (line boxes, word bank, events).
- No book text in the library, only metadata.
- Secrets in `.env`, never in code or git. Provide `.env.example` with every variable name and a comment.

Required env vars (names only): `DATABASE_URL`, `NEMOTRON_BASE_URL`, `NEMOTRON_API_KEY`, `NVIDIA_BUILD_API_KEY`, `GEMINI_API_KEY`, `LLM_PROVIDER`, `APP_NAME`, `LOG_LEVEL`.

## 11. Coding conventions

- **Python**: type hints everywhere, Pydantic v2 models for all I/O, `async` endpoints, `ruff` + `ruff format`, `pytest` + `pytest-asyncio`. No business logic in routers; routers call services/brain modules.
- **TypeScript**: strict mode, ESLint + Prettier, functional components and hooks, no `any` in `src/api` or `src/glasses`.
- Keep prompts in `brain/prompts/` as versioned files, not inline strings.
- Every model call goes through `brain/llm.py` so providers can be swapped and calls can be logged and rate-limited in one place.
- Small PRs, one concern each. Commit messages: `area: short imperative summary` (e.g. `brain: add page analyzer schema`).
- Do not add new dependencies without saying why in the PR.

## 12. Commands (create these in the Makefile)

```
make dev        # docker compose up (api + mariadb); run the web app separately with `make web`
make web        # pnpm --filter web dev (Vite, http://localhost:5173)
make migrate    # alembic upgrade head
make test       # pytest (api) + vitest (web)
make lint       # ruff (api) + eslint/prettier/tsc (web)
make contracts  # regenerate openapi.json and TS types
make eval       # run eval/run_eval.py
```

## 13. Build order (follow this; stop at each checkpoint and let a human test)

1. **Scaffold** the whole tree above with empty modules, working `make dev`, health endpoint, DB connection, and a web app that boots (`pnpm --filter web dev`) with the `GlassesAdapter`, `WebSimulatorAdapter` and display simulator. Checkpoint: `GET /health` returns OK and is reachable from the web app; app renders in the browser.
2. **Contracts**: page JSON schema, OpenAPI export, generated TS types.
3. **Vertical slice**: photo of a page -> OCR -> `/pages/analyze` (Nemotron) -> page JSON -> highlight a phrase on the display simulator (via `GlassesAdapter`).
4. **Finger guidance** in the browser: hand tracking -> nearest line -> phrase highlight.
5. **Glasses**: `MetaDatAdapter`: DAT camera stream in, display/audio out. Fall back to the web simulator if DAT or display APIs block us.
6. **Word help**: tap or ask a word -> contextual definition + breakdown -> word bank row.
7. **Gemini Live** conversation with server-side context injection and `ask_brain()`.
8. **Illustrations** and progress/fading.
9. **Polish for demo**: demo book, runbook, offline-safe fallbacks.

Each step should leave `main` runnable.

## 14. Instructions to Claude when working in this repo

- First task when asked to scaffold: create the directory tree in section 4 with minimal placeholder files (docstring or `TODO(owner)` comment per module), configs, `.env.example`, `docker-compose.yml`, `Makefile`, and READMEs per app. Do not implement features yet.
- Respect ownership boundaries in section 2. If a task crosses them, say so and propose the contract first.
- When something is unspecified or uncertain (DAT display coverage, Nemotron VL memory on Verda, exact endpoint paths), do not invent details: leave a clearly marked `TODO` or `OPEN QUESTION:` and list it in your summary.
- Prefer the simplest thing that works for a 48-hour hackathon demo; note any shortcut as `HACK:` so it can be revisited.
- Never commit secrets, real user images, or copyrighted book text.
- Before declaring a task done: run lint and tests for the touched app, and state what you could not verify (especially anything needing real glasses hardware).
