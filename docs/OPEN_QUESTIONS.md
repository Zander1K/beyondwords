# Open questions

Decisions left open during the step 1 scaffold (2026-11-14). Each one is also marked
`OPEN QUESTION:` in the code where it applies. When you resolve one, record the answer here
(or delete the row) and update the code it points to.

| # | Question | Owner | Where in code | Blocks step |
|---|---|---|---|---|
| 1 | The SOP is missing from the repo; `docs/SOP.md` is a placeholder. It is needed for the page JSON schema (SOP 8.1), final endpoint paths (SOP 5) and latency targets (SOP 9). | Mick Ola | `docs/SOP.md`, `apps/api/app/schemas/page.py`, `apps/api/app/routers/*.py` | 2 |
| 2 | ~~Book text in `lines`~~ **Resolved by SOP section 5:** `lines.text` stores the captured line text, used only to ground that reader's answers, and is deleted when the book is finished or on request. Phrase chunks and hard words live in the page JSON (`pages.analysis`). Still to build: the deletion job when `user_books.finished_at` is set. | Mick Ola | `apps/api/app/db/models.py` (`Line`, `UserBook`) | 9 |
| 3 | Are line bounding boxes in pixels or normalised 0–1? | Matthew + Alex | `apps/api/app/db/models.py` (`Line.bbox_*`) | 2 |
| 4 | Users and login: real sign-in, a device id, or a demo user only? SOP section 5 settles the profile columns (`support_level`, `voice`, `glasses_type`, no contact details); spacing preferences stay in `users.settings` JSON. Also open: the format of `users.voice` (depends on the phone TTS engine). | Mick Ola + Alex | `apps/api/app/db/models.py` (`User`) | 3 |
| 5 | ~~`books.level` scale~~ **Resolved:** the SOP's `books` table has no level, so the column was dropped (with `edition`). Still open: which public metadata source fills `books` (e.g. Open Library) and what goes in `metadata_source`. | Mick Ola | `apps/api/app/db/models.py` (`Book`) | 15 |
| 6 | When does a word move from `learning` to `owned` in `word_bank.status` (e.g. N `solo_reads` in a row)? SOP section 5 gives the columns but not the rule. | Mick Ola + Matthew | `apps/api/app/db/models.py` (`WordBankEntry`) | 9 |
| 7 | Which values can `LLM_PROVIDER` take (e.g. `nemotron`, `nvidia_build`, `gemini`, `muse_spark`)? | Matthew | `.env.example`, `apps/api/app/config.py`, `apps/api/app/brain/llm.py` | 3 |
| 8 | Which tool generates the TypeScript types for `make contracts` (e.g. `openapi-typescript`)? | Mick Ola | `Makefile` (`contracts`), `packages/contracts/README.md` | 2 |
| 9 | Does an Expo community DAT wrapper (e.g. `expo-meta-wearables-dat`) support the display and Neural Band, or do we need a native module? | Alex | `apps/mobile/src/glasses/index.ts` | 5 |
| 10 | Which on-phone OCR and hand-tracking libraries (MediaPipe Hands vs Apple Vision; OCR lib)? | Alex | `apps/mobile/src/vision/index.ts` | 3–4 |
| 11 | iOS bundle id and Android package name (needed for DAT development builds). | Alex | `apps/mobile/app.config.ts` | 5 |
| 12 | What GPU and memory are available on Verda, and does Nemotron 3.5 Super VL fit? NVIDIA Build is the fallback. | Matthew | `infra/verda/README.md` | 3 |
| 13 | Where does the team keep the eval page photos? They are git-ignored and must not be committed. | Matthew | `eval/pages/README.md` | 3 |
| 14 | The database is now PostgreSQL instead of MariaDB (decided by Mick Ola, 2026-11-14). The SOP still says MariaDB in sections 5, 10 and 12, and it is the source of truth: update it, and confirm with Matthew and Alex. | Mick Ola | `docs/SOP.md`, CLAUDE.md section 3 | 3 |

## Not yet verified (environment gaps)

The step 1 scaffold machine had no Docker, so these still need a first run:

- `make dev` (docker compose up) and the Docker image build for `apps/api`.
- `make migrate` inside Docker. Migration `0001` has been run against a local PostgreSQL 17
  outside Docker (2026-11-14), but not yet through `docker compose`.
- `/health` reporting `"database": "ok"` against a live DB.
- The Expo app on a physical phone (only the iOS JS bundle was built).
- Anything on real glasses hardware.
