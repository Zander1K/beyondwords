# Brain: what it does and how to wire it

Owner: Matthew. Code: `apps/api/app/brain/`. Source of truth: the SOP (sections 8, 9, 11),
except where the decisions below differ.

## Scope

Nemotron does page analysis, word meanings, Everyday-mode document reading, and answers every
**question about the book** (grounded, cited, spoiler-free). **Gemini handles the conversation
itself**: voice, turn-taking, encouragement, "not now", Talk About It and small talk. Any book
question in a conversation goes to `ask_brain()` / `POST /ask`; Gemini speaks the answer.

The brain is plain async Python with no FastAPI or DB imports. Routers (Mick Ola) call these
functions and map the results to HTTP. Nothing here touches `app/db`, `app/gemini` or `routers/`.

## Entry points for the routers

| Endpoint | Call | Returns | On `LLMError` |
|---|---|---|---|
| `POST /page` | `page_analyzer.analyze_page(page_id=, ocr_lines=, image=, book=, profile=)` | `PageAnalysis` (`schemas/page.py`) | return `page_analyzer.fallback_page(page_id, ocr_lines)`; phone says "Explanations are paused. Reading continues." |
| `POST /words/define` (proposed, not in the SOP) | `tools.define.define_word(word, sentence, book)` | `WordBreakdown` (word, syllables, say_as, meaning, illustratable) | use `text_utils.syllabify(word)` only |
| `POST /ask` | `agent.ask(question=, user_id=, book_id=, store=, current_page=, extra_pages=, illustrator=, history=, on_event=)` | `AskResult` (`schemas/brain.py`) | never raises; returns a safe spoken line |
| Gemini Live `ask_brain()` | `agent.ask_brain(question, **session)` | text to speak | same |
| `POST /document` | `document_reasoner.read_document(ocr_lines=, image=)` | `ActionCard` | say "Everyday mode is paused" |
| Everyday follow-up via `/ask` | `agent.ask(..., current_page=document_reasoner.document_page(ocr_lines))` | `AskResult` citing `doc:L3` | same as `/ask` |
| `WS /trace` | pass `on_event=` to `agent.ask` | `TraceEvent` per step | trace is best-effort |

`pages.image_hash` can use `page_analyzer.image_hash(image)`. The photo is never kept.

## Word lookup flow

1. `POST /page` returns `hard_words`, each with syllables, `say_as`, an in-context meaning and
   `illustratable`. The phone caches them.
2. Reader points at a word and pinches (gesture is Alex's call). The phone finds the word from
   its own word-level OCR boxes (the page JSON only has line boxes).
3. Word is in `hard_words`: show it from the cache, no model call (SOP 9 "instant from cache").
   Otherwise: `POST /words/define` with the word and its sentence -> `define_word()`.
4. The router adds the word to `word_bank` and logs a `word_rescued` event.

## What the brain needs from Mick Ola

Two small interfaces in `brain/tools/store.py`. Implement them with the repositories and the
Gemini image client, and pass instances into `agent.ask`:

- `BrainStore`: `get_book_context(book_id)`, `get_captured_pages(user_id, book_id, page_numbers)`,
  `add_to_word_bank(user_id, book_id, word, context_sentence, page_id)`.
  `get_captured_pages` must only return pages the reader captured: that is the no-spoiler rule.
  `page_numbers` are printed labels (text), matching `pages.page_number`.
- `Illustrator`: `illustrate(concept) -> url | None` (Gemini image generation).

`InMemoryStore` and `NoIllustrator` are stand-ins for tests and eval.

For the Live bridge: inject the current page text and book metadata into the Gemini session on
open and on every page change, and route book questions to `ask_brain()` server-side when
Gemini skips the tool call (it fires in only ~60-70% of sessions).

## What the brain expects from Alex (phone)

`POST /page` and `POST /document` send the photo plus OCR lines as `OcrLine`:
`{"id": "L1", "text": "...", "bbox": [x, y, w, h], "confidence": 0.97}` with **bbox normalised
0-1** of the photo, top-left origin. Line ids are the phone's; the page JSON echoes them, so
the highlight can map chunks back to boxes. Every chunk belongs to one line and a line's chunks
rejoin exactly to its text. For Everyday follow-ups the phone keeps the document's OCR lines
and sends them back with the question.

## Decisions made (change them in a PR if you disagree)

| Decision | Why |
|---|---|
| Gemini runs the conversation; Nemotron answers every book question | team decision 2026-11-14: Gemini is better at conversation, but only Nemotron's answers are grounded and checked before they are spoken |
| `conversation_plan` removed from the page JSON (prompt `page_analyzer.v2`) | it only fed Talk About It, which Gemini now runs; differs from SOP 8.1 |
| Everyday mode keeps nothing on the server, not even in memory; the phone resends the lines for follow-ups | makes SOP 10 "not stored" strictly true; drops the SOP's `extract_action` tool, which was only a cache lookup |
| `page_number` is the printed label as text ("12", "xiv"); `text_utils.page_order()` sorts roman front matter before arabic pages, and labels it cannot place are kept | matches `pages.page_number` varchar; the no-spoiler filter still needs an order |
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

- Exact NVIDIA Build model id for the fallback (`BRAIN_NVIDIA_BUILD_MODEL`).
- Whether the hosted vLLM accepts `response_format` json_schema and native tool calls (the code
  falls back if `response_format` is rejected; tool calls are assumed per the organisers'
  opencode config, `"tools": true`).
- Eval has no meaning-quality metric yet; consider a "meaning correct in context" check per
  hard word, since word meanings are core to the NVIDIA submission.
- First real `make eval --label baseline` once the 20-page set exists.
