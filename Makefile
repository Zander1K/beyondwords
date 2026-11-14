.PHONY: help local nemotron-check dev down db api web web-lan migrate test test-api test-web lint lint-api lint-web format contracts eval install env
.DEFAULT_GOAL := help

API_DIR := apps/api
WEB_DIR := apps/web
# Fixed local ports, from .env (defaults match .env.example).
API_PORT := $(or $(shell grep -E '^API_PORT=' .env 2>/dev/null | cut -d= -f2),38417)
WEB_PORT := $(or $(shell grep -E '^WEB_PORT=' .env 2>/dev/null | cut -d= -f2),41263)

help:               ## List commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:[^#]*## /\t/' | column -t -s "$$(printf '\t')"

env:
	@[ -f .env ] || (cp .env.example .env && echo "Created .env from .env.example")

install: env        ## Install API (uv) and JS (pnpm) dependencies
	cd $(API_DIR) && uv sync
	pnpm install

dev: env            ## Start api + postgres (mobile dev server: `pnpm mobile` in another terminal)
	docker compose up --build

local: env         ## Run the API and the web app together (API :$(API_PORT), web :$(WEB_PORT)); Ctrl-C stops both
	@echo "API  http://localhost:$(API_PORT)   (docs: /docs)"
	@echo "Web  http://localhost:$(WEB_PORT)   (calls the API at /api)"
	@$(MAKE) -j2 api web

db: env             ## Start only postgres in the background (pair with `make api`)
	docker compose up -d postgres

api: env            ## Run the API on the host with auto-reload (no Docker needed; DB optional)
	cd $(API_DIR) && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port $(API_PORT)

web:                ## Run the web app dev server on http://localhost:$(WEB_PORT) (Vite)
	pnpm --filter web dev

web-lan:            ## Web app over HTTPS on your network, for phones (self-signed cert)
	@echo "Open https://$$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | cut -d' ' -f1):$(WEB_PORT) on your phone (same Wi-Fi) and accept the certificate warning."
	pnpm --filter web dev:lan

down:               ## Stop the docker compose stack
	docker compose down

migrate:            ## alembic upgrade head (inside the api container)
	docker compose run --rm api alembic upgrade head

test: test-api test-web   ## pytest (api) + vitest (web)

test-api:
	cd $(API_DIR) && uv run pytest

test-web:
	pnpm --filter web test

lint: lint-api lint-web   ## ruff (api) + eslint/prettier/tsc (web)

lint-api:
	cd $(API_DIR) && uv run ruff check . && uv run ruff format --check .

lint-web:
	pnpm --filter web lint

format:             ## Auto-fix API lint and formatting
	cd $(API_DIR) && uv run ruff check --fix . && uv run ruff format .

contracts:          ## Regenerate openapi.json and TS types
	# FastAPI -> packages/contracts/openapi.json -> packages/contracts/ts/schema.ts
	# (openapi-typescript). Commit both files; the app imports from @reading-companion/contracts.
	cd $(API_DIR) && uv run python -m scripts.export_openapi
	pnpm --filter @reading-companion/contracts generate

nemotron-check:     ## Ping the Nemotron endpoint from .env (IMAGE=path.jpg to test vision)
	cd $(API_DIR) && PYTHONPATH=. uv run python ../../infra/scripts/nemotron_check.py $(IMAGE)

eval:               ## Page-analysis + grounding evaluation
	cd $(API_DIR) && uv run python ../../eval/run_eval.py
