# API contracts

Human-readable mirror of `packages/contracts`. Run `make contracts` after changing any API
schema: it writes `packages/contracts/openapi.json` and the TypeScript types in
`packages/contracts/ts/schema.ts` (openapi-typescript). Commit both. Import types from
`@reading-companion/contracts` (friendly names in `ts/index.ts`). The live schema is also at
`/docs` (Swagger UI) on a running API.

Browser clients: the API allows CORS from the origins in `CORS_ORIGINS` (default
`http://localhost:5173`, the web app's Vite dev server). Add your tunnel URL there when testing
on a phone.

| Method | Path | Status |
|---|---|---|
| GET | `/health` | Implemented. `{"status": "ok", "app": str, "database": "ok" \| "unavailable"}` |
| POST | `/ask` | Implemented. Reader question (text) -> spoken-style answer. See below. |
| DELETE | `/ask/sessions/{id}` | Implemented. Forget a conversation now (`204`). |
| POST | `/books/identify` | Implemented (barcode / ISBN path). See below. |
| GET | `/books/{id}` | Implemented. Book metadata for context (same fields as below, without `cached`). |
| POST | `/illustrate` | Implemented. Word, phrase or one sentence -> picture. See below. |
| GET | `/illustrations/{id}` | Implemented. Image bytes (`image/png` or `image/jpeg`). |

Other planned endpoints are listed in SOP section 5.

## `POST /books/identify`

Identify the exact book and edition from its barcode. The phone scans the barcode (Alex) and
sends the value; the backend looks in our `books` table first, then Google Books, then Open
Library, and saves new books so the next scan is instant.

Request:

```json
{"isbn": "9780141439518"}
```

`isbn` is whatever the barcode scanner returned (EAN-13 starting 978 or 979) or a typed ISBN-10 /
ISBN-13. Hyphens, spaces and a 2- or 5-digit price add-on after the barcode are accepted.

Response `200`:

```json
{
  "id": 1,
  "isbn": "9780141439518",
  "title": "Pride and Prejudice",
  "author": "Jane Austen",
  "publication_year": 2003,
  "language": "en",
  "genre": "Fiction",
  "setting_era": null,
  "description_spoiler_free": null,
  "metadata_source": "google_books",
  "cached": false
}
```

- `isbn` is always returned as ISBN-13, whatever was scanned.
- `cached: true` means the book was already in our library and no external call was made.
- `publication_year` is this edition's year, not the original publication year.
- `setting_era` and `description_spoiler_free` are not filled by the lookup (publisher blurbs often
  contain spoilers); they come later from Nemotron or seed data.

Errors (`{"detail": "<one short reason>"}`):

| Status | When | What the app should do (SOP 7.2, 9) |
|---|---|---|
| 422 | Not a book barcode (e.g. a product EAN), bad check digit, or not an ISBN at all | Ask to scan the barcode on the back cover again |
| 404 | Valid ISBN, but neither Google Books nor Open Library knows it | Offer to point at the cover instead (Nemotron path, TODO) |
| 503 | Database down, or both metadata services down | Say so briefly; reading still works without book context |

The cover-photo path (Nemotron reads the title or ISBN off the cover, SOP 8.5) is not built yet.

## `POST /ask`

The reader's question, already turned into text by the phone. The phone reads `answer` aloud
through the glasses with its own text-to-speech, and shows `image_url` on the display if set.
Gemini runs the conversation and asks the book expert (Nemotron) when needed.

Request:

```json
{
  "question": "What does aloof mean here?",
  "session_id": null,
  "book_id": 1,
  "page_lines": [{"id": "L4", "text": "Mr. Darcy was aloof and proud."}],
  "current_line_id": "L4"
}
```

- `session_id`: omit or `null` for a new conversation; send back the one from the last answer
  for follow-ups ("why did he do that?"). Conversations are forgotten after 30 minutes idle.
- `book_id`: from `POST /books/identify`. Optional; an unknown id is ignored, not an error.
- `page_lines`: HACK, the current page's lines until the backend stores pages (`POST /page`).

Response `200`:

```json
{
  "session_id": "4f1c...",
  "answer": "Here it means cold and distant. Mr. Darcy keeps away from people and seems proud.",
  "cited_lines": [],
  "image_url": null,
  "used_brain": false,
  "tool_steps": []
}
```

- `answer` is two or three short sentences, written to be spoken.
- `cited_lines` are line ids the book expert used; `used_brain` says whether it was asked.
- `image_url` is set when Gemini showed a picture (`GET` it from the API).
- `tool_steps` lists the tools Gemini called, for the trace screen.

Errors: `503` with `{"detail": "Explanations are paused. Reading continues."}` when Gemini is
unavailable; the app can speak the message as is (SOP 9). `422` for an empty or oversized request.

## `POST /illustrate` and `GET /illustrations/{id}`

Draw a picture of what the reader points at or asks about: one word, a short phrase, or one
sentence (max 30 words / 200 characters). Two calls: the first returns a description and a
link, the second returns the image bytes. Same text + book returns the cached picture.

Request:

```json
{"text": "portcullis", "book_id": 3, "setting_era": "medieval England"}
```

`book_id` (from `/books/identify`) and `setting_era` are optional; both help draw the right
thing for the book and period.

Response `200`:

```json
{
  "id": "4f1c…",
  "text": "portcullis",
  "kind": "word",
  "scene": "A heavy iron grille gate raised above a castle gateway…",
  "planned": true,
  "mime_type": "image/png",
  "url": "/illustrations/4f1c…"
}
```

`url` is relative to the API base URL. Errors (`detail` is one short line the app can speak):

| Status | When | What the app does |
|---|---|---|
| `422` | Not one word/phrase/sentence, or better explained than pictured | Speak `detail`; offer the definition instead |
| `503` | Gemini down or slow: "Illustrations are paused. Reading continues." | Speak it once; keep reading |
| `404` on `GET /illustrations/{id}` | Image expired (in-memory cache, cleared on API restart) | Call `POST /illustrate` again |

Client sketch for the web or mobile app (`API_BASE_URL` as in `apps/web/src/config`):

```ts
import type { IllustrateRequest, IllustrateResponse } from "@reading-companion/contracts";

export async function illustrate(
  body: IllustrateRequest,
  signal?: AbortSignal,
): Promise<IllustrateResponse & { imageUrl: string }> {
  const response = await fetch(`${API_BASE_URL}/illustrate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const { detail } = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(
      response.status,
      detail ?? `POST /illustrate failed with ${response.status}`,
      response.headers.get("X-Request-ID"),
    );
  }
  const result = (await response.json()) as IllustrateResponse;
  // Use imageUrl directly as an <img src>; the browser fetches GET /illustrations/{id}.
  return { ...result, imageUrl: `${API_BASE_URL}${result.url}` };
}
```
