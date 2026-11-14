# Open questions

Decisions left open during the step 1 scaffold (2026-11-14). Each one is also marked
`OPEN QUESTION:` in the code where it applies. When you resolve one, record the answer here
(or delete the row) and update the code it points to.

| # | Question | Owner | Where in code | Blocks step |
|---|---|---|---|---|
| 1 | The SOP is missing from the repo; `docs/SOP.md` is a placeholder. It is needed for the page JSON schema (SOP 8.1), final endpoint paths (SOP 5) and latency targets (SOP 9). | Mick Ola | `docs/SOP.md`, `apps/api/app/schemas/page.py`, `apps/api/app/routers/*.py` | 2 |
| 2 | Book text in `lines`: saving phrase splits and hard words means saving words from the book, which may conflict with "never store book text" (CLAUDE.md section 5). What should `lines.phrases` and `lines.hard_words` hold? | Mick Ola + Matthew | `apps/api/app/db/models.py` (`Line`) | 2–3 |
| 3 | Are line bounding boxes in pixels or normalised 0–1? | Matthew + Alex | `apps/api/app/db/models.py` (`Line.bbox_*`) | 2 |
| 4 | Users and login: real sign-in, a device id, or a demo user only? Where do reading preferences (spacing, fade level) live? For now they are in a `users.settings` JSON column. | Mick Ola | `apps/api/app/db/models.py` (`User`) | 3 |
| 5 | What scale is `books.level`: age band, Lexile, or free text? | Mick Ola | `apps/api/app/db/models.py` (`Book.level`) | 6 |
| 6 | How does word review work (states, spaced repetition)? `word_bank.review_state` is a free string defaulting to `new` for now. | Mick Ola | `apps/api/app/db/models.py` (`WordBankEntry`) | 6 |
| 7 | Which values can `LLM_PROVIDER` take (e.g. `nemotron`, `nvidia_build`, `gemini`, `muse_spark`)? | Matthew | `.env.example`, `apps/api/app/config.py`, `apps/api/app/brain/llm.py` | 3 |
| 8 | Which tool generates the TypeScript types for `make contracts` (e.g. `openapi-typescript`)? | Mick Ola | `Makefile` (`contracts`), `packages/contracts/README.md` | 2 |
| 9 | Does an Expo community DAT wrapper (e.g. `expo-meta-wearables-dat`) support the display and Neural Band, or do we need a native module? | Alex | `apps/mobile/src/glasses/index.ts` | 5 |
| 10 | Which on-phone OCR and hand-tracking libraries (MediaPipe Hands vs Apple Vision; OCR lib)? | Alex | `apps/mobile/src/vision/index.ts` | 3–4 |
| 11 | iOS bundle id and Android package name (needed for DAT development builds). | Alex | `apps/mobile/app.config.ts` | 5 |
| 12 | ~~What GPU and memory are available on Verda, and does Nemotron 3.5 Super VL fit?~~ Resolved 2026-11-14: Verda hosts it for Junction (vLLM 0.32, NVFP4 on B300, 1M context) at the `NEMOTRON_BASE_URL` in `.env.example`, so we don't self-host. Still open: rate limits on the shared endpoint. | Matthew | `infra/verda/README.md` | 3 |
| 13 | Where does the team keep the eval page photos? They are git-ignored and must not be committed. | Matthew | `eval/pages/README.md` | 3 |

## Not yet verified (environment gaps)

The step 1 scaffold machine had no Docker, so these still need a first run:

- `make dev` (docker compose up) and the Docker image build for `apps/api`.
- `make migrate` against a real MariaDB. Migration `0001` was hand-written and checked only
  structurally (SQLite test) and by rendering MariaDB SQL offline (`alembic upgrade head --sql`).
- `/health` reporting `"database": "ok"` against a live DB.
- The Expo app on a physical phone (only the iOS JS bundle was built).
- Anything on real glasses hardware.
