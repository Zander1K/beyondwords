# api

FastAPI service (Python 3.11, async, Pydantic v2, SQLAlchemy 2 async + asyncpg, Alembic, PostgreSQL).

```sh
uv sync
uv run uvicorn app.main:app --reload     # needs DATABASE_URL; /health still answers if the DB is down
uv run pytest
uv run ruff check . && uv run ruff format --check .
uv run alembic upgrade head              # migrations live in ../../db/migrations
uv run alembic revision --autogenerate -m "short summary"   # needs a running PostgreSQL
```

- `app/config.py`: settings from env (`APP_NAME`, `DATABASE_URL`, ...).
- `app/routers/`: thin HTTP/WS layer. `app/brain/` (Matthew), `app/gemini/` + `app/db/` (Mick Ola).
- `GET /health` returns `{"status": "ok", "app": ..., "database": "ok" | "unavailable"}`.
