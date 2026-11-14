# Brain: what it does and how to wire it

Owner: Matthew. Code: `apps/api/app/brain/`. Source of truth: the SOP (sections 8, 9, 11),
except where the decisions below differ.

## Scope

Nemotron does page analysis, word meanings, Everyday-mode document reading, and answers every
**question about the book** (grounded, cited, spoiler-free). Finger tracking and working out
which word the reader is pointing at are the phone's job (CLAUDE.md section 7, SOP 6); the phone
sends the brain the word.

Questions come **straight from the phone's speech-to-text** to `POST /ask` (Mick's route),
which calls `qa.QuestionService` -> `agent.ask`: Nemotron answers every question, misheard page
words are fixed in code first (see "Questions from speech-to-text"), and `answer` is plain text
for the phone's TTS. Gemini only draws pictures, when the agent calls `illustrate`. If the team
also wants a Gemini chat (Talk About It), it can call the same agent through `ask_brain()`.

The brain is plain async Python with no FastAPI or DB imports. Routers (Mick Ola) call these
functions and map the results to HTTP. Nothing here touches `app/db`, `app/gemini` or `routers/`.

## Entry points for the routers

| Endpoint | Call | Returns | On `LLMError` |
|---|---|---|---|
| `POST /page` | `page_analyzer.analyze_page(page_id=, ocr_lines=, image=, book=, profile=)` | `PageAnalysis` (`schemas/page.py`) | return `page_analyzer.fallback_page(page_id, ocr_lines)`; phone says "Explanations are paused. Reading continues." |
| `POST /words/define` (proposed, not in the SOP) | `tools.define.define_word(word, sentence, book)` | `WordBreakdown` (word, syllables, say_as, meaning, illustratable) | use `text_utils.syllabify(word)` only |
| `POST /ask` (implemented, `routers/ask.py`) | `qa.get_question_service().ask(question, book=, page_lines=, current_line_id=, pointed_word=, session_id=, illustrator=)`, which wraps `agent.ask(...)` and keeps the last 4 turns per session | `QuestionReply` (answer, cited line ids, image URL, tool steps) | raises `QuestionUnavailableError` (down, or over `BRAIN_TIMEOUT_SECONDS`, 8 s) -> route returns 503 "Explanations are paused. Reading continues." |
| `ask_brain()` (only if a Gemini chat is added) | `agent.ask_brain(question, **session)` | text to speak | never raises |
| `POST /document` | `document_reasoner.read_document(ocr_lines=, image=)` | `ActionCard` | say "Everyday mode is paused" |
| Everyday follow-up via `/ask` | `agent.ask(..., current_page=document_reasoner.document_page(ocr_lines))` | `AskResult` citing `doc:L3` | same as `/ask` |
| `WS /trace` | pass `on_event=` to `agent.ask` | `TraceEvent` per step | trace is best-effort |

`pages.image_hash` can use `page_analyzer.image_hash(image)`. The photo is never kept.

## Word lookup flow

1. `POST /page` returns `hard_words`, each with syllables, `say_as`, an in-context meaning and
   `illustratable`. The phone caches them.
2. Reader points at a word and pinches (gesture is Alex's call). The phone works out the word
   from the fingertip and its OCR boxes (instant, works offline).
3. Word is in `hard_words`: show it from the cache, no model call (SOP 9 "instant from cache").
   Otherwise: `POST /words/define` with the word and its sentence -> `define_word()`.
4. The router adds the word to `word_bank` and logs a `word_rescued` event.

If OCR misread the word, the page JSON's `ocr_disagreements` holds Nemotron's reading of that
line (`model_text`); the phone can take the word's spelling from there before step 3.

## Questions from speech-to-text

`agent.ask()` takes the phone's transcript as `question`. Speech recognition mishears exactly
the unusual words readers ask about, so before the model sees the question,
`text_utils.correct_to_page_words` replaces near-matches of page words ("port cullis" ->
portcullis, "century" -> sentry, "sir coat" -> surcoat); only words printed on the injected
pages are used. Pass `pointed=` (`PointedWord`: the word, line id and sentence the phone picked) so
"what does this mean?" is about the word under the finger. For follow-ups the phone sends back `session_id`; `QuestionService` keeps the last 4 turns
and passes them to the agent as `history`. The
`heard_as` fix shows on the trace screen.

## What the brain needs from Mick Ola

Two small interfaces in `brain/tools/store.py`. Implement them with the repositories and the
Gemini image client, and pass instances into `agent.ask`:

- `BrainStore`: `get_book_context(book_id)`, `get_captured_pages(user_id, book_id, page_numbers)`,
  `add_to_word_bank(user_id, book_id, word, context_sentence, page_id)`.
  `get_captured_pages` must only return pages the reader captured: that is the no-spoiler rule.
  `page_numbers` are printed labels (text), matching `pages.page_number`.
- `Illustrator`: `illustrate(concept) -> url | None`. Done: `app/gemini/illustrator.py`
  (`GeminiIllustrator`) wraps Mick's IllustrationService; `/ask` passes it in.

`InMemoryStore` and `NoIllustrator` are stand-ins for tests and eval.

Until `POST /page` stores pages, `/ask` builds a one-page in-memory store from the lines the
phone sends, with no user id: answers can only use the current page, and `add_to_word_bank`
writes go nowhere. A `BrainStore` on the real tables (plus a user id on `/ask`) fixes both.

## What the brain expects from Alex (phone)

`POST /page` and `POST /document` send the photo plus OCR lines as `OcrLine`:
`{"id": "L1", "text": "...", "bbox": [x, y, w, h], "confidence": 0.97, "quad": [...]}` with
**bbox normalised 0-1** of the photo, top-left origin. `quad` (optional) is the line's four
corners; the fallback reading order uses it on tilted pages. Line ids are the phone's; the page JSON echoes them, so
the highlight can map chunks back to boxes. Every chunk belongs to one line and a line's chunks
rejoin exactly to its text. For Everyday follow-ups the phone keeps the document's OCR lines
and sends them back with the question.

## Decisions made (change them in a PR if you disagree)

| Decision | Why |
|---|---|
| Nemotron answers every reader question behind `POST /ask` (`brain/qa.py`); Gemini only draws pictures | team decision 2026-11-14: with speech on the phone, a Gemini layer in front added two model hops and reworded Nemotron's checked answer with nothing checking the result |
| `conversation_plan` removed from the page JSON (prompt `page_analyzer.v2`) | it only fed Talk About It, which is not being built by the brain; differs from SOP 8.1 |
| Everyday mode keeps nothing on the server, not even in memory; the phone resends the lines for follow-ups | makes SOP 10 "not stored" strictly true; drops the SOP's `extract_action` tool, which was only a cache lookup |
| `page_number` is the printed label as text ("12", "xiv"); `text_utils.page_order()` sorts roman front matter before arabic pages, and labels it cannot place are kept | matches `pages.page_number` varchar; the no-spoiler filter still needs an order |
| Endpoint names follow the SOP (`/page`, `/ask`, `/document`), not CLAUDE.md's proposals | SOP wins on conflicts |
| bbox normalised 0-1 (OPEN QUESTION 3) | independent of camera resolution |
| Captured line text is stored per reader until the book is finished or on request (OPEN QUESTION 2) | SOP 5 "Book data rule" and SOP 10 data inventory say so |
| `LLM_PROVIDER` is `nemotron` (Verda, NVIDIA Build fallback if `NVIDIA_BUILD_API_KEY` is set) or `nvidia_build` (OPEN QUESTION 7) | Gemini is the voice, not a reasoning provider (SOP 8.4) |
| Line text in the page JSON comes from phone OCR; Nemotron's different readings go in `ocr_disagreements` | the phone highlights OCR boxes; SOP 9 asks to re-capture on disagreement |
| Citations look like `[p12:L2]` or `[book]`; uncited sentences are removed; one re-ask if nothing survives **or a sentence was removed**, keeping the better-grounded answer; if the re-ask fails, the grounded part of the first answer is kept | SOP 8.2; models sometimes give a correct word meaning without its citation, and the re-ask recovers it (~1 s extra, only then) |
| `OcrLine.quad` (optional line corners) added to the contract | tilt-aware fallback reading order; upright boxes overlap neighbouring lines when the page slants |
| No backend pointing endpoint: the phone picks the word and sends it | agreed design (CLAUDE.md 7, SOP 6): instant, offline, no round trip. A server-side pointing check with a Nemotron crop was built and dropped on 2026-11-14 |
| Misheard page words are corrected in code before the model sees the question (prompt `reading_coach.v2`) | prompting the model about mishearings made it comment on them ("the word is sentry, not century") and hurt unrelated answers; fixing the text first gave 9/9 on misheard and normal questions |
| Fallback reading order is tilt-aware and reads columns one at a time (`geometry.visual_order`) | the old y-sort interleaved two columns |
| `define_word` returns the word as printed, not the model's dictionary form | the phone matches it to what the reader pointed at |
| OCR disagreements are word-level (`text_utils.word_differences`), not a whole-line similarity threshold | the old 0.9 line threshold could never flag a one-word misread ("busted" for "rusted" is 98% similar); found by the live smoke test |
| `eval/smoke_brain.py`: end-to-end run of every job on a rendered, tilted photo with a finger, against the live model, including `POST /ask` over HTTP (Pillow is a dev-only dependency for it) | run it before a demo; 18 checks |
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
- Hard-word recall (0.75-0.94) and syllable accuracy (0.5-0.86) swing between runs on the 4
  samples (page_analyzer prompt unchanged): too few pages to tell; recheck on the 20-page set,
  and try `BRAIN_PAGE_REASONING=true` there.
- First real `make eval --label baseline` once the 20-page set exists.
