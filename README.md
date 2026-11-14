# Beyond Words

Smart-glasses add-on for Meta AI glasses that helps people who find reading effortful read
printed books comfortably. It reads *with* you, keeps your place and explains hard words in context.
Built for Junction 2026. The app is called **Beyond Words**; change `APP_NAME` in `.env` to rename it.

See `CLAUDE.md` for the full brief and `docs/SOP.md` for product behaviour.
Unresolved decisions are tracked in [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md).

The frontend is a **web app that mirrors the glasses**: the browser stands in for Meta glasses
(camera, mic, speakers, a Ray-Ban Display simulator, keys for Neural Band gestures). All glasses
I/O goes through one `GlassesAdapter`, so a real Meta DAT adapter can replace the simulator
later. See [`docs/glasses-adapter.md`](docs/glasses-adapter.md). (It replaced an earlier
React Native app; git history has it.)

## Layout

| Path | What | Owner |
|---|---|---|
| `apps/web` | React + Vite web app that mirrors the glasses (browser as glasses simulator) | Alex |
| `apps/api` | FastAPI service | Matthew (brain), Mick Ola (db, gemini) |
| `packages/contracts` | Shared API types (OpenAPI + generated TS) | Mick Ola |
| `db/` | Alembic migrations, seed data | Mick Ola |
| `infra/` | Verda/vLLM serving, scripts | Matthew / Mick Ola |
| `eval/` | Page-analysis and grounding eval | Matthew |

## Prerequisites

Docker (with Compose v2.24+), Python 3.11 + [uv](https://docs.astral.sh/uv/), Node 20+ and pnpm 10.

## Quick start

API only, no Docker (fastest): `make install && make api`, then open http://localhost:8000.
Details in [`apps/api/README.md`](apps/api/README.md).

Full stack:

```sh
cp .env.example .env     # make dev does this for you if missing
make install             # uv sync (api) + pnpm install (web)
make dev                 # api on http://localhost:8000 + mariadb on :3306
make migrate             # in another terminal: create the tables
curl localhost:8000/health
make web                 # web app on http://localhost:5173 (same as `pnpm --filter web dev`)
```

## Commands

| Command | Does |
|---|---|
| `make dev` | `docker compose up` (api + mariadb) |
| `make web` | Web app dev server (Vite) on http://localhost:5173 |
| `make api` | Run the API on the host with reload (no Docker) |
| `make db` | Start only MariaDB in Docker (pair with `make api`) |
| `make format` | Auto-fix API lint and formatting |
| `make migrate` | `alembic upgrade head` in the api container |
| `make test` | pytest (api) + vitest (web) |
| `make lint` | ruff (api) + eslint/prettier/tsc (web) |
| `make contracts` | Regenerate `openapi.json` and TS types (step 2, not yet implemented) |
| `make eval` | Run `eval/run_eval.py` (not yet implemented) |
