# Brain: what it does and how to wire it

Owner: Matthew. Code: `apps/api/app/brain/`. Source of truth: the SOP (sections 8, 9, 11).

The brain is plain async Python with no FastAPI or DB imports. Routers (Mick Ola) call these
functions and map the results to HTTP. Nothing here touches `app/db`, `app/gemini` or `routers/`.

## Entry points for the routers

| Endpoint (SOP 5) | Call | Returns | On `LLMError` |
|---|---|---|---|
| `POST /page` | `page_analyzer.analyze_page(page_id=, ocr_lines=, image=, book=, profile=)` | `PageAnalysis` (SOP 8.1, `schemas/page.py`) | return `page_analyzer.fallback_page(page_id, ocr_lines)`; phone says "Explanations are paused. Reading continues." |
| `POST /ask` | `agent.ask(question=, user_id=, book_id=, store=, current_page=, extra_pages=, illustrator=, history=, on_event=)` | `AskResult` (`schemas/brain.py`) | never raises; returns a safe spoken line |
| Gemini Live `ask_brain()` | `agent.ask_brain(question, **session)` | text to speak | same |
| `POST /document` | `document_reasoner.read_document(ocr_lines=, image=)` | `ActionCard` | say "Everyday mode is paused" |
| Everyday follow-up via `/ask` | `agent.ask(..., current_page=document_reasoner.document_page(doc_id))` | `AskResult` citing `doc:L3` | same as `/ask` |
| Word Breakdown for a word not in the page JSON | `tools.define.define_word(word, sentence, book)` | `WordBreakdown` | use `text_utils.syllabify(word)` only |
| `WS /trace` | pass `on_event=` to `agent.ask` | `TraceEvent` per step | trace is best-effort |

`pages.image_hash` can use `page_analyzer.image_hash(image)`. The photo is never kept.

## What the brain needs from Mick Ola

Two small interfaces in `brain/tools/store.py`. Implement them with the repositories and the
Gemini image client, and pass instances into `agent.ask`:

- `BrainStore`: `get_book_context(book_id)`, `get_captured_pages(user_id, book_id, page_numbers)`,
  `add_to_word_bank(user_id, book_id, word, context_sentence, page_id)`.
  `get_captured_pages` must only return pages the reader captured: that is the no-spoiler rule.
- `Illustrator`: `illustrate(concept) -> url | None` (Gemini image generation).

`InMemoryStore` and `NoIllustrator` are stand-ins for tests and eval.

Also for the Live bridge (SOP 8.3): inject `PageAnalysis.conversation_plan` and the current
page text into the Gemini session on open and on every page change; do not rely on Gemini
calling `ask_brain()`.

## What the brain expects from Alex (phone)

`POST /page` and `POST /document` send the photo plus OCR lines as `OcrLine`:
`{"id": "L1", "text": "...", "bbox": [x, y, w, h], "confidence": 0.97}` with **bbox normalised
0-1** of the photo, top-left origin. Line ids are the phone's; the page JSON echoes them, so
the highlight can map chunks back to boxes. Every chunk belongs to one line and a line's chunks
rejoin exactly to its text.

## Decisions made (change them in a PR if you disagree)

| Decision | Why |
|---|---|
| Endpoint names follow the SOP (`/page`, `/ask`, `/document`), not CLAUDE.md's proposals | SOP wins on conflicts |
| bbox normalised 0-1 (OPEN QUESTION 3) | independent of camera resolution |
| Captured line text is stored per reader until the book is finished or on request (OPEN QUESTION 2) | SOP 5 "Book data rule" and SOP 10 data inventory say so |
| `LLM_PROVIDER` is `nemotron` (Verda, NVIDIA Build fallback if `NVIDIA_BUILD_API_KEY` is set) or `nvidia_build` (OPEN QUESTION 7) | Gemini is the voice, not a reasoning provider (SOP 8.4) |
| Line text in the page JSON comes from phone OCR; Nemotron's different readings go in `ocr_disagreements` | the phone highlights OCR boxes; SOP 9 asks to re-capture on disagreement |
| Citations look like `[p12:L2]` or `[book]`; uncited sentences are removed; one re-ask if nothing survives | SOP 8.2 |
| Thinking pass off by default for all three jobs (`BRAIN_*_REASONING`) | SOP 9 latency targets; turn on per job if `make eval` shows it pays |
| Timeouts: ask 8 s, document 15 s, page 30 s (background) | SOP 9 says 8 s per call; page analysis is not on the critical path |
| Brain tuning lives in `brain/settings.py` (`BRAIN_` env prefix), not `app/config.py` | keeps brain changes inside `brain/` |
| Answers are returned whole, not streamed | grounding needs the full answer; stream sentence-by-sentence later if latency needs it (HACK) |
| pyphen dependency | dictionary syllable check and offline fallback (SOP 8.2 `syllabify`) |

## Open for Matthew

- Verda endpoint: key accepted, but the container did not answer for 10+ minutes on 2026-11-14
  (cold start or overload). Re-run `make nemotron-check`; ask Verda/NVIDIA mentors if it persists.
- Exact NVIDIA Build model id for the fallback (`BRAIN_NVIDIA_BUILD_MODEL`).
- Whether the hosted vLLM accepts `response_format` json_schema and native tool calls (the code
  falls back if `response_format` is rejected; tool calls are assumed per the organisers'
  opencode config, `"tools": true`).
- First real `make eval --label baseline` once the 20-page set exists.
