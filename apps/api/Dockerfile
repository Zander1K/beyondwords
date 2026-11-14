# Build context is the repo root (see docker-compose.yml) so migrations in db/ are included.
# Aiven Runtime: build path ".", Dockerfile path "apps/api/Dockerfile", container port 8000
# (docs/deploy-aiven.md).
FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1

WORKDIR /srv/apps/api
COPY apps/api/pyproject.toml apps/api/uv.lock* ./
RUN uv sync --no-dev --no-install-project

COPY apps/api/ ./
COPY db/migrations /srv/db/migrations

EXPOSE 8000
# Aiven Runtime has no pre-deploy step, so migrations run on every start (a no-op when the
# database is already at head). Set RUN_MIGRATIONS=0 to skip.
# --proxy-headers: Aiven terminates HTTPS and forwards plain HTTP.
CMD ["sh", "-c", "if [ \"${RUN_MIGRATIONS:-1}\" = \"1\" ]; then alembic upgrade head; fi && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
