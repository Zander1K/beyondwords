# api

FastAPI service (Python 3.11, async, Pydantic v2, SQLAlchemy 2 async + aiomysql, Alembic).

## Get started (5 minutes)

You need Python 3.11 and [uv](https://docs.astral.sh/uv/) (`brew install uv`). Docker is
optional: it is only needed for a local MariaDB.

```sh
# from the repo root
make install        # creates .env from .env.example, installs deps
make api            # http://localhost:8000  (auto-reloads on save)
```

Open http://localhost:8000. It redirects to the interactive docs (`/docs`), where you can call
every endpoint from the browser. `GET /health` works without a database and reports
`"database": "unavailable"`.

With a database:

```sh
make db             # MariaDB in Docker on :3306
make migrate        # create the tables (or: cd apps/api && uv run alembic upgrade head)
make api
```

Or run everything in Docker with `make dev`.

To use the brain, put the Verda key in `.env` as `NEMOTRON_API_KEY` (ask Matthew) and run
`make nemotron-check`. To test vision, run `make nemotron-check IMAGE=/absolute/path/page.jpg`.
In code, always call the model through `get_llm()` in `app/brain/llm.py`. Pass
`reasoning=False` for fast calls (~0.3 s instead of several seconds).

To call the API from a phone on the same Wi-Fi, use your laptop's LAN IP
(`ipconfig getifaddr en0`), e.g. `http://192.168.1.20:8000`. `make api` listens on all interfaces.

## Everyday commands

| Command | Does |
|---|---|
| `make api` | Run the API locally with reload |
| `make test-api` | `pytest` |
| `make lint-api` | `ruff check` + `ruff format --check` (CI-style) |
| `make format` | Auto-fix lint and formatting |
| `uv run alembic revision --autogenerate -m "summary"` | New migration (needs a running MariaDB) |

Run `make lint-api test-api` before pushing.

## Layout

| Path | What | Owner |
|---|---|---|
| `app/main.py` | App setup, router registration | shared |
| `app/config.py` | Settings from env (`APP_NAME`, `DATABASE_URL`, ...) | Mick Ola |
| `app/middleware.py` | Request ids (`X-Request-ID`), JSON 500s, log format | shared |
| `app/routers/` | Thin HTTP/WS layer, no business logic | shared |
| `app/schemas/` | Pydantic request/response models (the API contract) | shared, see below |
| `app/brain/` | Nemotron, page analysis, agent, grounding | Matthew |
| `app/gemini/` | Gemini Live bridge, `ask_brain()`, images | Mick Ola |
| `app/db/` | Models, session, repositories | Mick Ola |
| `app/tests/` | pytest (async, `asyncio_mode = auto`) | everyone |

## Adding an endpoint

1. **Schema**: request/response models in `app/schemas/<area>.py`. These are the contract with
   the mobile app, so tag the other owner in the PR (CLAUDE.md section 2).
2. **Logic**: in `app/brain/`, `app/gemini/` or `app/db/repositories/`, not in the router.
3. **Router**: in `app/routers/<area>.py`, make an `APIRouter(prefix=..., tags=[...])` and call
   the logic. Register it in `app/main.py` with `app.include_router(...)`.
4. **Test**: in `app/tests/`, following `test_health.py` (httpx `AsyncClient` + `ASGITransport`,
   mocking external calls).

`app/routers/health.py` is the smallest complete example.

## Conventions

- Every response carries `X-Request-ID`. Unhandled errors return
  `{"detail": "Internal server error", "request_id": "..."}` and are logged with the same id.
  Send `X-Request-ID` from the client to trace a request end to end.
- Every model call goes through `app/brain/llm.py`. Prompts live in `app/brain/prompts/`.
- Secrets only in `.env` (never committed). If you add a variable, add it to `.env.example`
  with a comment.
- Commit messages: `area: short imperative summary`, e.g. `api: add request id middleware`.
