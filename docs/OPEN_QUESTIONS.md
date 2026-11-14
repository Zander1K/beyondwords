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
| 9 | How does the web app reach Meta DAT (a native SDK): companion app bridge or native shell? And does DAT expose display output and Neural Band input? The RN wrapper we evaluated before the web migration did not. | Alex | `apps/web/src/glasses/meta-dat/MetaDatAdapter.ts`, `docs/glasses-adapter.md` | 5 |
| 10 | ~~Which in-browser OCR and hand-tracking libraries?~~ Resolved 2026-11-14: MediaPipe HandLandmarker and PaddleOCR (`ppu-paddle-ocr`, PP-OCRv6 tiny, unwarping fallback). Still open: speed on mid-range phones. | Alex | `apps/web/src/vision/` | 3–4 |
| 11 | Real Ray-Ban Display text limits (characters per line, lines, font size) and the display's position in the right lens. The simulator uses guesses (HACK). | Alex | `apps/web/src/glasses/simulator-ui/displayModel.ts`, `DisplaySimulator.tsx` | 5 |
| 12 | ~~What GPU and memory are available on Verda, and does Nemotron 3.5 Super VL fit?~~ Resolved 2026-11-14: Verda hosts it for Junction (vLLM 0.32, NVFP4 on B300, 1M context) at the `NEMOTRON_BASE_URL` in `.env.example`, so we don't self-host. Still open: rate limits on the shared endpoint. | Matthew | `infra/verda/README.md` | 3 |
| 13 | Where does the team keep the eval page photos? They are git-ignored and must not be committed. | Matthew | `eval/pages/README.md` | 3 |
| 14 | What audio format does Gemini Live expect from the web app (sample rate, chunk size), and is the `/live` message protocol JSON or binary? The simulator mic emits PCM16 at the browser's native rate. | Mick Ola + Alex | `apps/web/src/live/index.ts`, `apps/web/src/glasses/web-simulator/WebSimulatorAdapter.ts` | 7 |
| 16 | Neural Band and touchpad on real glasses: the exact gesture set, and which gestures DAT forwards to third-party apps (touchpad hold and the capture button may be reserved for Meta AI / the system camera). The simulator mapping is our assumption. | Alex | `apps/web/src/glasses/web-simulator/gestures.ts`, `docs/glasses-adapter.md` | 5 |
| 17 | Voice on real glasses: can a DAT app have a wake word, or only push-to-talk? "Hey Meta" wakes Meta AI. The simulator's wake phrase is simulator-only. | Alex + Mick Ola | `apps/web/src/glasses/web-simulator/voice.ts` | 5, 7 |
| 18 | Does DAT report battery level, volume and worn/folded state to apps (the mock kit has don/doff and fold)? | Alex | `apps/web/src/glasses/meta-dat/MetaDatAdapter.ts` | 5 |
| 19 | Browser OCR accuracy on real camera photos (curved pages, glare, small print, two columns). PaddleOCR measured only on synthetic photos: 97-100% word recall with the unwarping fallback, 64/65 words picked correctly by fingertip position. Word boxes are estimated from character widths within each line. Compare with Nemotron VL in `eval/`. | Alex + Matthew | `apps/web/src/vision/ocr.ts`, `paddleOcr.worker.ts` | 3 |
| 20 | Camera gestures vs finger reading with one camera: thresholds for pinches, swipes, line hysteresis and hand-lost are guesses. Tune on real footage. | Alex | `apps/web/src/glasses/web-simulator/cameraGestures.ts`, `apps/web/src/vision/` | 4 |
| 15 | `GlassesAdapter` has no connect/register step, and `startCamera()` returns a `MediaStream`; real DAT needs registration and does not hand JS a `MediaStream`. Change the interface before building `MetaDatAdapter`? | Alex | `apps/web/src/glasses/adapter.ts` | 5 |

## Not yet verified (environment gaps)

The step 1 scaffold machine had no Docker, so these still need a first run:

- `make dev` (docker compose up) and the Docker image build for `apps/api`.
- `make migrate` against a real MariaDB. Migration `0001` was hand-written and checked only
  structurally (SQLite test) and by rendering MariaDB SQL offline (`alembic upgrade head --sql`).
- `/health` reporting `"database": "ok"` against a live DB.
- The web app's camera, mic and audio in a real browser, and over an HTTPS tunnel on a phone.
- Anything on real glasses hardware.
