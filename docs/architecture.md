# Architecture

TODO(Mick Ola): diagram and notes. Summary from CLAUDE.md section 7:

- Phone: DAT camera stream in, on-device hand tracking + OCR, highlight state, display/audio out.
- API (FastAPI): page analysis, word help, progress, Gemini Live bridge (`WS /live`).
- Brain (Nemotron on Verda via vLLM, NVIDIA Build fallback) behind `brain/llm.py`.
- PostgreSQL: metadata, derived page data, word bank, reading events. No book text, no raw media.
