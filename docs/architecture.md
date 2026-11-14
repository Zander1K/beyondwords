# Architecture

TODO(Mick Ola): diagram and notes. Summary from CLAUDE.md section 7:

- Web app (`apps/web`, React + Vite): stands in for the glasses. Camera, mic and speakers come
  from the browser; a simulator panel stands in for the Ray-Ban Display; keys stand in for
  Neural Band gestures. Hand tracking, OCR and line picking run in the browser (planned).
  All glasses I/O goes through `GlassesAdapter` (`docs/glasses-adapter.md`); a
  `MetaDatAdapter` for real glasses comes later.
- API (FastAPI): page analysis, word help, progress, Gemini Live bridge (`WS /live`). Allows
  the web app's origin via `CORS_ORIGINS` (HTTP CORS, plus an origin check on `/live`).
- Brain (Nemotron on Verda via vLLM, NVIDIA Build fallback) behind `brain/llm.py`.
- MariaDB: metadata, derived page data, word bank, reading events. No book text, no raw media.
