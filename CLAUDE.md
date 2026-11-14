# CLAUDE.md — Smart Glasses Reading Companion (monorepo)

> Working name: **Reading Companion** (final name TBD; keep it in one config constant, `APP_NAME`, so renaming is a one-line change).
> Source of truth for product behaviour: the "Smart Glasses Reading Companion — Application SOP" doc. If this file and the SOP disagree, the SOP wins. Flag the conflict instead of guessing.

## 1. What we are building

A smart-glasses add-on for Meta AI glasses that helps people with dyslexia (and anyone who finds reading effortful) read **printed books**, with everyday documents as a secondary use. Focus: education and guided learning.

Core idea: the problem is **decoding, not comprehension**. The app reads *with* the user (not *for* them), keeps their place, explains hard words in context, and gradually fades its support as the reader gets stronger.

Built for the Junction 2026 hackathon (Meta "AI Glasses for Everyone, Everyday" challenge, plus NVIDIA Nemotron and Google Gemini tracks). Prioritise a working, demoable vertical slice over completeness.

### Core user loop
1. User opens a book and points the glasses camera at a page.
2. Phone captures the frame, runs OCR + hand tracking, backend analyses the page.
3. User runs a finger under a line; the current phrase is highlighted on the glasses display and read aloud (read-along).
4. User asks questions by voice ("what does *aloof* mean here?", "why did he do that?"); the phone turns speech into text, Gemini answers as text (grounded by the backend brain), and the phone reads the answer aloud through the glasses.
5. Progress and a personal word bank are saved to PostgreSQL.

## 2. Team and ownership

| Person | Owns | Primary directories |
|---|---|---|
| Matthew | Brain of the app (NVIDIA Nemotron) | `apps/api/app/brain/` |
| Alex | Frontend, Meta Wearables Device Access Toolkit (DAT) | `apps/mobile/` |
| Mick Ola | Architecture, PostgreSQL, Gemini integration | `apps/api/app/db/`, `apps/api/app/gemini/`, `infra/`, `db/` |

Cross-boundary changes (API contracts, schema, shared types) need a note in the PR description tagging the other owner. Do not silently change a contract.

## 3. Stack (fixed — do not substitute without asking)

| Layer | Choice |
|---|---|
| Glasses | Meta Ray-Ban Display (full) and Ray-Ban Meta Gen 2 (audio-first) via Meta Wearables DAT 1.0 |
| Mobile app | React Native + Expo (TypeScript). Community wrappers for DAT (e.g. `expo-meta-wearables-dat`); a native module is likely needed for display / Neural Band |
| API / middleware | FastAPI (Python 3.11+), async, Pydantic v2 |
| Database | PostgreSQL (SQLAlchemy 2.x async + asyncpg + Alembic migrations). Switched from MariaDB on 2026-11-14; the SOP still says MariaDB and needs updating. |
| Brain | NVIDIA Nemotron 3.5 Super VL, served with vLLM on **Verda**. NVIDIA Build is the fallback (free tier ~40 req/min/key) |
| Voice / conversation | Speech-to-text and text-to-speech on the phone; Gemini (`gemini-4-hydrogen`) runs the text conversation behind `POST /ask` and calls our `ask_brain()` tool. Changed from Gemini Live audio on 2026-11-14 (docs/gemini.md); the SOP still says Gemini Live. |
| Illustrations | Gemini image generation via the `illustrate()` tool |
| Model layer | Swappable via `brain/llm.py` so Meta Muse Spark can replace Gemini in production |

## 4. Repository layout (scaffold this)

```
.
├── CLAUDE.md
├── README.md
├── .env.example
├── docker-compose.yml            # api + postgres for local dev
├── Makefile                      # make dev, make test, make migrate, make lint
├── docs/
│   ├── SOP.md                    # export of the SOP doc (reference only)
│   ├── architecture.md
│   └── api-contracts.md          # human-readable mirror of packages/contracts
├── packages/
│   └── contracts/                # SHARED source of truth for API types
│       ├── openapi.json          # generated from FastAPI, committed
│       └── ts/                   # generated TypeScript types for the mobile app
├── apps/
│   ├── mobile/                   # React Native + Expo (Alex)
│   │   ├── app.config.ts
│   │   ├── package.json
│   │   └── src/
│   │       ├── app/              # screens / navigation (Expo Router)
│   │       ├── glasses/          # DAT wrapper: camera stream, mic, speaker, display, Neural Band
│   │       ├── vision/           # hand tracking (MediaPipe Hands / Apple Vision), OCR, line picking
│   │       ├── reader/           # highlight state machine, phrase pacing, read-along
│   │       ├── live/             # conversation: speech-to-text, POST /ask, text-to-speech
│   │       ├── api/              # typed client generated from packages/contracts
│   │       ├── state/            # app state (Zustand)
│   │       ├── ui/               # components, spacing-first typography
│   │       └── __tests__/
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

## 5. Data model (PostgreSQL)

Tables: `users`, `books`, `user_books`, `pages`, `lines`, `word_bank`, `reading_events`.

Columns follow SOP section 5; `apps/api/app/db/models.py` documents each one.

- `users`: display name, `support_level` (listen / read_along / solo), voice, `glasses_type`; no contact details.
- `books`: **metadata only** (ISBN, title, author, publication year, language, genre, setting/era, spoiler-free description, metadata source). **Never store book text.** The library exists so the brain knows which book a word appears in and can give contextual help, and so progress can be tracked.
- `user_books`: where each reader is in each book (current page and line, started / last read / finished).
- `pages` / `lines`: pages a reader captured (image hash and page JSON, never the image) and the captured line text with boxes. Line text is used only to ground that reader's answers and is deleted when the book is finished or on request.
- `word_bank`: one row per reader per word: times rescued, solo reads, status (learning / owned), where it was last seen, context sentence.
- `reading_events`: append-only log (page read, word rescued, question asked, mode changed) with mode and duration, used for progress metrics and fading support.
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
| POST | `/ask` | Reader question (text) -> short spoken-style answer via Gemini + `ask_brain()` (implemented; replaces `WS /live`) |

The paths marked above beyond `/books/identify`, `/progress` and `/live` are proposed; confirm against SOP section 5 and adjust. The **page JSON schema** is defined in SOP section 8.1. Implement it exactly as Pydantic models in `app/schemas/page.py`, generate OpenAPI, and generate TS types from it so mobile and backend can never drift.

## 7. How the pieces cooperate

- **Finger tracking runs on the phone**, not on the glasses and not in the cloud: MediaPipe Hands or Apple Vision finds the fingertip; OCR line boxes pick the nearest line; the reader module turns that into the current phrase.
- **Nemotron handles understanding**: reading order, phrase boundaries, hard words, document reasoning, grounding checks, conversation plans.
- **Gemini runs the conversation as text** (voice stays on the phone) and calls `ask_brain()`. Tool calls are not guaranteed to fire, so:
  - **Inject page and book context server-side** on every question; never rely on the tool call to get context.
- **Highlight shows on the glasses display only**, not on the paper. Ray-Ban Display: 600x600, ~20 degree FOV, right lens. Ray-Ban Meta Gen 2 has no display, so degrade to audio cues.
- No eye tracking exists. Do not design around gaze.
- Meta AI's own on-glasses vision is **not** exposed to apps. Our app uses the camera feed via DAT.

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
- Gemini unavailable -> `POST /ask` returns 503 "Explanations are paused. Reading continues."; reading keeps working.
- Always log failures with a request id; never crash the reading session.

Evaluation: `eval/pages/` holds a small set of real photos (curved book spines, shadows, glare, two-column, small print, children's books). `eval/run_eval.py` reports OCR line accuracy, reading-order accuracy and grounding pass rate. Run it before changing prompts or models.

## 10. Privacy

- Camera frames and audio are processed to serve the request; do not persist raw images or audio unless a feature explicitly needs it and the user has opted in.
- Store derived data only (line boxes, word bank, events).
- No book text in the library, only metadata.
- Secrets in `.env`, never in code or git. Provide `.env.example` with every variable name and a comment.

Required env vars (names only): `DATABASE_URL`, `NEMOTRON_BASE_URL`, `NEMOTRON_API_KEY`, `NVIDIA_BUILD_API_KEY`, `GEMINI_API_KEY`, `GEMINI_CHAT_MODEL`, `GEMINI_IMAGE_MODEL`, `GOOGLE_BOOKS_API_KEY`, `LLM_PROVIDER`, `APP_NAME`, `LOG_LEVEL`.

## 11. Coding conventions

- **Python**: type hints everywhere, Pydantic v2 models for all I/O, `async` endpoints, `ruff` + `ruff format`, `pytest` + `pytest-asyncio`. No business logic in routers; routers call services/brain modules.
- **TypeScript**: strict mode, ESLint + Prettier, functional components and hooks, no `any` in `src/api` or `src/glasses`.
- Keep prompts in `brain/prompts/` as versioned files, not inline strings.
- Every model call goes through `brain/llm.py` so providers can be swapped and calls can be logged and rate-limited in one place.
- Small PRs, one concern each. Commit messages: `area: short imperative summary` (e.g. `brain: add page analyzer schema`).
- Do not add new dependencies without saying why in the PR.

## 12. Commands (create these in the Makefile)

```
make dev        # docker compose up (api + postgres), run mobile dev server separately
make migrate    # alembic upgrade head
make test       # pytest (api) + jest (mobile)
make lint       # ruff + eslint
make contracts  # regenerate openapi.json and TS types
make eval       # run eval/run_eval.py
```

## 13. Build order (follow this; stop at each checkpoint and let a human test)

1. **Scaffold** the whole tree above with empty modules, working `make dev`, health endpoint, DB connection, and an Expo app that boots. Checkpoint: `GET /health` returns OK; app renders on a phone.
2. **Contracts**: page JSON schema, OpenAPI export, generated TS types.
3. **Vertical slice**: photo of a page -> OCR -> `/pages/analyze` (Nemotron) -> page JSON -> highlight a phrase on a phone screen (mock the glasses).
4. **Finger guidance** on the phone: hand tracking -> nearest line -> phrase highlight.
5. **Glasses**: DAT camera stream in, display/audio out. Fall back to phone-only if display APIs block us.
6. **Word help**: tap or ask a word -> contextual definition + breakdown -> word bank row.
7. **Gemini conversation** (`POST /ask`, text in and out) with server-side context injection and `ask_brain()`.
8. **Illustrations** and progress/fading.
9. **Polish for demo**: demo book, runbook, offline-safe fallbacks.

Each step should leave `main` runnable.

## 14. Instructions to Claude when working in this repo

- First task when asked to scaffold: create the directory tree in section 4 with minimal placeholder files (docstring or `TODO(owner)` comment per module), configs, `.env.example`, `docker-compose.yml`, `Makefile`, and READMEs per app. Do not implement features yet.
- Respect ownership boundaries in section 2. If a task crosses them, say so and propose the contract first.
- When something is unspecified or uncertain (DAT display coverage in Expo wrappers, Nemotron VL memory on Verda, exact endpoint paths), do not invent details: leave a clearly marked `TODO` or `OPEN QUESTION:` and list it in your summary.
- Prefer the simplest thing that works for a 48-hour hackathon demo; note any shortcut as `HACK:` so it can be revisited.
- Never commit secrets, real user images, or copyrighted book text.
- Before declaring a task done: run lint and tests for the touched app, and state what you could not verify (especially anything needing real glasses hardware).
