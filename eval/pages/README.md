# Eval pages

The real 20-page test set from SOP section 11. Everything in this folder except this README is
git-ignored: never commit real user images, book scans or copyrighted text. Share the set
through the team drive. OPEN QUESTION: which drive folder (Matthew).

Committed, original-text examples of the format live in `eval/samples/`.

## The set (SOP 11)

- 12 book pages: paperback, hardback, two-column, page with a caption, page near the spine
- 4 difficult captures: glare, slight blur, low light, curved page
- 4 everyday documents: utility bill, bank letter, appointment letter, form

## Format

One JSON file per page, plus an optional photo with the same name (`.jpg`, `.jpeg` or `.png`).
With a photo, the brain gets the image and OCR disagreements are measured; without one it
works from the OCR lines only.

Book page:

```json
{
  "kind": "book",
  "page_id": "p12",
  "page_number": 12,
  "book": {"title": "...", "author": "...", "genre": "...", "setting_era": "...", "language": "en-GB"},
  "ocr_lines": [{"id": "L1", "text": "...", "bbox": [0.1, 0.1, 0.8, 0.04]}],
  "reading_order": ["L1", "L2"],
  "hard_words": ["portcullis"],
  "questions": [
    {"question": "What is a portcullis?", "answer_lines": ["p12:L3"]},
    {"question": "what does port cullis mean", "answer_lines": ["p12:L3"], "must_mention": "portcullis"}
  ]
}
```

`ocr_lines` is what the phone's OCR returns for the photo (bbox normalised 0-1, see
`apps/api/app/schemas/page.py`). Until Alex's OCR is wired, type the lines in from the photo.
`hard_words` are the words a dyslexic reader would flag; `questions` have 3 per page with the
lines a correct answer must cite. Add one or two questions typed the way speech-to-text would
mishear them, with `must_mention` set to the page word the answer has to use.

If the phone OCR gives line corner points, include them as `quad` on each line (see
`apps/api/app/schemas/page.py`).

Everyday document:

```json
{
  "kind": "document",
  "page_id": "doc",
  "ocr_lines": [...],
  "expected": {"deadline_iso": "2026-11-28", "amount_text": "€84.20", "action_keywords": ["pay"]}
}
```

Run `make eval` (or `--label baseline`, then `--label after-fixes`) and copy the numbers from
`eval/results/` into SOP section 11 and the NVIDIA submission.
