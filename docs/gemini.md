# Gemini integration: conversation and illustrations

Owner: Mick Ola. Code lives in `apps/api/app/gemini/`. Product behaviour comes from SOP sections
8.3 (Gemini), 8.4 (model roles) and 10 (privacy); if this file and the SOP disagree, the SOP wins
and the conflict goes in `docs/OPEN_QUESTIONS.md`.

**Design change (2026-11-14, Mick Ola): no Gemini voice.** Speech stays on the phone: it turns the
reader's speech into text, and reads answers aloud through the glasses speakers with its own
text-to-speech (the SOP already gives the phone TTS). Gemini only runs the conversation, as text.
This replaces the Gemini Live audio stream (`WS /live`) in SOP 8.3. OPEN QUESTION: update the SOP
and check the Google track pitch, which mentions "Gemini Live conversation" (OPEN_QUESTIONS.md).

Model facts were checked against Google's docs on 2026-11-14 (sources at the end).

## Which models

| Job | Model ID | Env var | Notes |
|---|---|---|---|
| Conversation (Ask Out Loud, Talk About It) | `gemini-4-hydrogen` | `GEMINI_CHAT_MODEL` | GA 2026-11-12, "Fast". Run with thinking level `low` to keep answers quick. |
| Illustrations | `gemini-3.1-flash-lite-image` | `GEMINI_IMAGE_MODEL` | Fastest and cheapest. Switch to `gemini-nano-banana-2.1` for higher quality by changing the env var. |

Not used: `gemini-3.8-live` (audio stream; see the design change above), Imagen 4 (shut down
2026-08-17).

## Conversation (`POST /ask`)

### Shape

```
glasses mic -> phone: speech-to-text -> POST /ask {question, session_id, book_id, page_lines}
   FastAPI -> Gemini (gemini-4-hydrogen), up to 4 tool steps
               |  ask_brain(question) -> brain agent (Nemotron, Matthew): grounded answer + cited lines
               |  illustrate(text)    -> image service: picture for the display
   <- {answer, session_id, cited_lines, image_url, used_brain, tool_steps}
phone: text-to-speech -> glasses speakers; show image_url on the display if set
```

### One turn

1. **System instruction** = the coaching rules (`brain/prompts/reading_coach_v1.txt`, from SOP
   8.2: two or three short spoken sentences, page text and tools only, no spoilers) + the current
   reading context: book details (looked up by `book_id`), the page's lines, and the line the
   finger is on. Context is rebuilt on every request, so it is always the current page and never
   depends on a tool call firing.
2. **Contents** = this session's earlier turns (last 10) + the new question, so follow-ups work
   ("why did he do that?").
3. **Tool loop**, at most 4 steps (SOP 8.2). Tool errors go back to Gemini as a result, never as a
   failure: if ask_brain is down or slower than 8 s, Gemini answers from the page text or says it
   is not sure yet.
4. **Reply**: the answer text, plus cited lines (from ask_brain), an image URL (from illustrate)
   and the tools used (for the trace screen).

Sessions: `session_id` comes back with every answer; send it with the next question to continue.
They live in memory and are forgotten after 30 minutes idle or on
`DELETE /ask/sessions/{id}`. HACK: in-process store, one API instance only.

### Tools exposed to Gemini

| Tool | Does | Status |
|---|---|---|
| `ask_brain(question)` | Nemotron agent answers from captured pages, citing line ids (SOP 8.2) | Interface ready (`app/gemini/tools.py`, `Brain`). OPEN QUESTION (Mick + Matthew): agree it. Until Matthew's agent exists, `UnavailableBrain` is used. |
| `illustrate(text)` | Picture of a word, phrase or one sentence for the display | Working (`app/gemini/images.py`) |
| `add_to_word_bank(word)` | Save a struggled word | TODO: needs the user, so it waits for `POST /session` |

### Errors

Any Gemini failure (no key, timeout, error, no answer) returns `503` with
`"Explanations are paused. Reading continues."`, which the phone can speak as is (SOP 9). An
unknown or unreachable `book_id` never fails the question; it is answered without book details.

### Left off deliberately

- **Google Search grounding**: answers must come only from captured pages and book metadata
  (SOP 8.5, no spoilers).
- **Camera frames to Gemini**: vision is Nemotron's job, and page images stay away from another
  processor.

## Illustrations (`illustrate()`)

- **When**: on "Show me" (SOP 7.3) for what the reader points at or asks about. Display only;
  Gen 2 skips it.
- **Input**: a word, a short phrase (up to 4 words) or **one sentence** (max 30 words, 200
  characters), one picture per request. Paragraphs, pages, several sentences, links and odd
  characters are rejected with a 422. A sentence is drawn as the single main moment it describes,
  never a comic strip. OPEN QUESTION: SOP 8.4 allows concrete words only, never whole scenes; the
  sentence input needs team sign-off and an SOP update (`docs/OPEN_QUESTIONS.md`).
- **Request and response**: `POST /illustrate` with `{"text": "...", "setting_era": "..."}`
  returns `{"id", "text", "kind": "word" | "phrase" | "sentence", "mime_type", "url"}`;
  `GET /illustrations/{id}` serves the image bytes. On any Gemini failure the endpoint returns a
  503 with "Illustrations are paused. Reading continues."
- **Model and size**: `GEMINI_IMAGE_MODEL`, 1K resolution, 1:1 aspect ratio. The Ray-Ban Display
  is 600x600, so speed matters more than resolution.
- **Style**: clean editorial illustration for readers aged 16 and over (SOP section 2), like the
  art in a good non-fiction book: natural proportions, muted colours, no cartoon faces. Changed
  from a picture-book style on 2026-11-14 because it read as children's art. TODO: also send one
  fixed style reference image with every request (the models accept up to 14) for consistency.
- **Prompt**: `brain/prompts/illustrate_v3.txt` (versioned, CLAUDE.md section 11), filled with
  the text and the book's era and setting so "carriage" in a 19th-century novel looks right. It
  bans any text in the image (sentences contain quoted words) and keeps scenes calm, showing
  tension without injury or fear.
- **Cache** by `(text, book setting_era, model, prompt version)`. Same text, same picture: saves
  cost and makes repeats instant. Generated images are not user data, so caching is allowed.
- **Delivery**: Gemini returns base64 image data; we cache it and hand out a URL
  (`GET /illustrations/{id}`), which also matches the SOP's `/ask` "image URL". OPEN QUESTION
  (Mick + Alex): confirm the URL approach suits the app.
- All generated images carry Google's SynthID watermark automatically.

## Privacy (SOP section 10)

- No audio reaches the backend or Google: speech-to-text and text-to-speech run on the phone.
- Question and answer text is kept in memory only for the conversation (max 30 minutes idle),
  never written to the database or logs.
- Page images never go to Gemini. Page line text and the reader's questions do; the consent screen
  must name Google as a processor of conversation text and illustration prompts.
- Trace events carry tool names, timings and short text only, never audio or images.

## Task list (in SOP build order)

| # | Task | Gate (SOP 12) | Status |
|---|---|---|---|
| 1 | `google-genai` SDK and model settings | 5 | Done (`google-genai` 3.3, `GEMINI_CHAT_MODEL`, `GEMINI_IMAGE_MODEL`) |
| 2 | Agree `POST /ask` with Alex: request and response above; speech-to-text and text-to-speech on the phone | 5 | To do (Alex) |
| 3 | Conversation service: sessions, context per turn, tool loop, timeouts | 5 | Done (`app/gemini/conversation.py`, `POST /ask`, tests) |
| 4 | `ask_brain()` contract with Matthew, then connect his agent | 5 | Interface ready; waiting on Matthew |
| 5 | Look up the page's lines server-side once `POST /page` stores them (drop `page_lines` from the request) | 5 | To do (after Matthew's /page) |
| 6 | Grounding check of each answer by Nemotron, word-bank updates from the conversation | 5 | To do (with Matthew) |
| 7 | Emit tool calls and replies to `WS /trace` (`tool_steps` is already returned) | 6 | To do |
| 8 | Illustrations | 7 | Done except the style reference image and a first live call |
| 9 | Talk About It: start a conversation with the page's `conversation_plan` question, respect "not now" | 8 | To do |
| 10 | Stream answers (send the first sentence before the rest) if latency needs it | 9 | Later, only if measured latency is a problem |
| 11 | Privacy checks and consent copy naming Google | all | To do |

## Not verified yet

- A live Gemini call: there was no `GEMINI_API_KEY` in `.env` when this was built.
- Answer latency with `gemini-4-hydrogen` at thinking level `low`.
- Image generation latency and pricing (not found in the docs).

## Sources

- [Gemini models](https://aistudio.google.com/docs/models)
- [Latest Gemini model (Gemini 4)](https://aistudio.google.com/docs/latest-model)
- [Live API overview](https://aistudio.google.com/docs/live-api) (considered, not used)
- [Image generation](https://aistudio.google.com/docs/image-generation)
- [Gemini API changelog](https://aistudio.google.com/docs/changelog)
