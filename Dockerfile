# API image (apps/api). Lives at the repo root so the build context is the root: it copies
# apps/api and db/migrations. Aiven Runtime picks this file and uses its folder as the build
# context; docker-compose.yml builds it too. Container port 8000 (docs/deploy-aiven.md).
FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
# One ENV per line with full values: Aiven's scanner copies these into the app's settings and
# mangled "$PATH" when it was referenced.
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
ENV PATH=/opt/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ENV PYTHONUNBUFFERED=1

WORKDIR /srv/apps/api
COPY apps/api/pyproject.toml apps/api/uv.lock* ./
RUN uv sync --no-dev --no-install-project

COPY apps/api/ ./
COPY db/migrations /srv/db/migrations

EXPOSE 8000
# Aiven Runtime has no pre-deploy step, so migrations run on every start (a no-op when the
# database is already at head). Set RUN_MIGRATIONS=0 to skip.
# --proxy-headers: Aiven terminates HTTPS and forwards plain HTTP.
CMD ["/bin/sh", "-c", "if [ \"${RUN_MIGRATIONS:-1}\" = \"1\" ]; then alembic upgrade head; fi && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
