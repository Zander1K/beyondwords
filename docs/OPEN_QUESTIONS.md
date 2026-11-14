# Open questions

Decisions left open during the step 1 scaffold (2026-11-14). Each one is also marked
`OPEN QUESTION:` in the code where it applies. When you resolve one, record the answer here
(or delete the row) and update the code it points to.

| # | Question | Owner | Where in code | Blocks step |
|---|---|---|---|---|
| 1 | The SOP is missing from the repo; `docs/SOP.md` is a placeholder. It is needed for the page JSON schema (SOP 8.1), final endpoint paths (SOP 5) and latency targets (SOP 9). | Mick Ola | `docs/SOP.md`, `apps/api/app/schemas/page.py`, `apps/api/app/routers/*.py` | 2 |
| 2 | ~~Book text in `lines`~~ **Resolved by SOP section 5:** `lines.text` stores the captured line text, used only to ground that reader's answers, and is deleted when the book is finished or on request. Phrase chunks and hard words live in the page JSON (`pages.analysis`). Still to build: the deletion job when `user_books.finished_at` is set. | Mick Ola | `apps/api/app/db/models.py` (`Line`, `UserBook`) | 9 |
| 3 | ~~Are line bounding boxes in pixels or normalised 0–1?~~ Brain proposal, to confirm with Alex: normalised 0–1, `[x, y, w, h]`, top-left origin, with optional `quad` corners (`schemas/page.py`, docs/BRAIN.md). | Matthew + Alex | `apps/api/app/schemas/page.py`, `apps/api/app/db/models.py` (`Line.bbox`) | 2 |
| 4 | ~~Users and login~~ Resolved 2026-11-14: username only, no password (`users.username`, migration 0002). Still open: the endpoint the phone calls to find or create a user (e.g. `POST /users`), to agree with Alex. SOP section 5 settles the profile columns (`support_level`, `voice`, `glasses_type`, no contact details); spacing preferences stay in `users.settings` JSON. Also open: the format of `users.voice` (depends on the phone TTS engine). | Mick Ola + Alex | `apps/api/app/db/models.py` (`User`) | 3 |
| 5 | ~~`books.level` scale~~ **Resolved:** the SOP's `books` table has no level, so the column was dropped (with `edition`). Still open: which public metadata source fills `books` (e.g. Open Library) and what goes in `metadata_source`. | Mick Ola | `apps/api/app/db/models.py` (`Book`) | 15 |
| 6 | ~~When does a word move from `learning` to `owned`?~~ **Proposed 2026-11-14 (Matthew, to confirm with Mick Ola):** after 3 solo reads, at most one a day, so on 3 different days; a solo read is a finished page with the word on it and no help with it (not in Listen mode); any new rescue sends it back to `learning`. Rules in `apps/api/app/brain/word_bank.py`, thresholds in `BRAIN_OWNED_AFTER_SOLO_READS` / `BRAIN_ONE_SOLO_READ_PER_DAY`. | Mick Ola + Matthew | `apps/api/app/db/models.py` (`WordBankEntry`) | 9 |
| 7 | ~~Which values can `LLM_PROVIDER` take?~~ Resolved 2026-11-14: `nemotron` (Verda, NVIDIA Build fallback when `NVIDIA_BUILD_API_KEY` is set) or `nvidia_build`. See docs/BRAIN.md. | Matthew | `.env.example`, `apps/api/app/config.py`, `apps/api/app/brain/llm.py` | 3 |
| 8 | ~~Which tool generates the TypeScript types for `make contracts`?~~ Resolved 2026-11-14: openapi-typescript 7.13.0 (`packages/contracts`). | Mick Ola | `Makefile` (`contracts`), `packages/contracts/README.md` | 2 |
| 9 | Does an Expo community DAT wrapper (e.g. `expo-meta-wearables-dat`) support the display and Neural Band, or do we need a native module? | Alex | `apps/mobile/src/glasses/index.ts` | 5 |
| 10 | Which on-phone OCR and hand-tracking libraries (MediaPipe Hands vs Apple Vision; OCR lib)? | Alex | `apps/mobile/src/vision/index.ts` | 3–4 |
| 11 | iOS bundle id and Android package name (needed for DAT development builds). | Alex | `apps/mobile/app.config.ts` | 5 |
| 12 | ~~What GPU and memory are available on Verda, and does Nemotron 3.5 Super VL fit?~~ Resolved 2026-11-14: Verda hosts it for Junction (vLLM 0.32, NVFP4 on B300, 1M context) at the `NEMOTRON_BASE_URL` in `.env.example`, so we don't self-host. Still open: rate limits on the shared endpoint. | Matthew | `infra/verda/README.md` | 3 |
| 13 | Where does the team keep the eval page photos? They are git-ignored and must not be committed. | Matthew | `eval/pages/README.md` | 3 |
| 14 | The database is now PostgreSQL instead of MariaDB (decided by Mick Ola, 2026-11-14). The SOP still says MariaDB in sections 5, 10 and 12, and it is the source of truth: update it, and confirm with Matthew and Alex. | Mick Ola | `docs/SOP.md`, CLAUDE.md section 3 | 3 |
| 15 | `POST /ask` contract with Alex: request `{question, session_id, book_id, page_lines, current_line_id}`, response `{session_id, answer, cited_lines, image_url, used_brain, tool_steps}` (docs/api-contracts.md). Speech-to-text and text-to-speech run on the phone. | Mick Ola + Alex | `apps/api/app/schemas/ask.py` | 5 |
| 16 | Illustration delivery: serve from `GET /illustrations/{id}` or send base64 inline? The SOP's `/ask` promises an image URL; Gemini returns base64. | Mick Ola + Alex | `apps/api/app/gemini/images.py` | 7 |
| 17 | ~~Affective Dialog on `gemini-3.8-live`~~ No longer applies: Gemini Live is not used (voice stays on the phone). Remove Affective Dialog from SOP 8.3. | Mick Ola | `docs/gemini.md` | 5 |
| 18 | ~~Proactive audio on `gemini-3.8-live`~~ No longer applies: Gemini Live is not used, so Gemini cannot speak unprompted. | Mick Ola | `docs/gemini.md` | 5 |
| 19 | ~~Async scheduling values~~ No longer applies: the text conversation calls tools in a normal loop. | Mick Ola | `apps/api/app/gemini/tools.py` | 5 |
| 20 | Use `gemini-4-hydrogen` as a fallback provider in `brain/llm.py` when Verda and NVIDIA Build are both down? | Matthew | `apps/api/app/brain/llm.py` | 3 |
| 21 | Illustrations now accept one sentence as well as a word or phrase (decided by Mick Ola, 2026-11-14). SOP 8.4 says concrete words only, never whole scenes. Confirm with the team, update the SOP, and decide whether the page JSON's `illustratable` flag should gate sentences too. Note: the sentence (book text) is sent to Gemini; the consent copy should say so. | Mick Ola (team) | `apps/api/app/gemini/images.py`, `docs/gemini.md` | 7 |
| 22 | Book lookup needs a Google Books API key: keyless calls got HTTP 429 every time on 2026-11-14, so lookups fell back to Open Library. Create a key restricted to the Books API and set `GOOGLE_BOOKS_API_KEY`. | Mick Ola | `.env`, `apps/api/app/books/providers.py` | 15 |
| 23 | Book records: add `publisher` and `cover_url` columns (a new migration) so the app can show "is this your copy?" with the cover (SOP 7.2 step 2)? And should `publication_year` be the edition year (stored now) or the original year, which matters more for era context (SOP 8.5)? | Mick Ola + Alex | `apps/api/app/db/models.py` (`Book`), `apps/api/app/books/` | 15 |
| 24 | Voice moved to the phone (2026-11-14, Mick Ola): Gemini runs a text conversation behind `POST /ask` instead of a Gemini Live audio stream. Update SOP 8.3 and the Google judging row ("Gemini Live conversation"), and ask the Google mentors if this still fits the Gemini track. | Mick Ola (team) | `docs/gemini.md`, CLAUDE.md section 3 | 5 |
| 25 | Who owns `POST /ask`? SOP 5 lists it as the Nemotron agent loop; it now runs the Gemini conversation, which calls Nemotron via `ask_brain()`. Agree the `Brain` interface in `app/gemini/tools.py` (`ask(question, context) -> BrainAnswer(text, cited_lines)`) with Matthew. | Mick Ola + Matthew | `apps/api/app/gemini/tools.py`, `apps/api/app/routers/ask.py` | 5 |
| 26 | Scene planning before illustrations (whether to draw a text, and a literal description of what to draw) is reasoning, so it belongs to the brain (SOP 8.4). HACK: it runs on the Gemini text model now. Should Matthew's Nemotron take it over via the `ScenePlanner` interface, and should page analysis fill it for hard words (`illustratable`, `meaning`)? | Mick Ola + Matthew | `apps/api/app/gemini/scene_planner.py` | 7 |

## Not yet verified (environment gaps)

The step 1 scaffold machine had no Docker, so these still need a first run:

- `make dev` (docker compose up) and the Docker image build for `apps/api`.
- `make migrate` inside Docker. Migration `0001` has been run against a local PostgreSQL 17
  outside Docker (2026-11-14), but not yet through `docker compose`.
- `/health` reporting `"database": "ok"` against a live DB.
- The Expo app on a physical phone (only the iOS JS bundle was built).
- Anything on real glasses hardware.
