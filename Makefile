.PHONY: help nemotron-check dev down db api web migrate test test-api test-web lint lint-api lint-web format contracts eval install env
.DEFAULT_GOAL := help

API_DIR := apps/api
WEB_DIR := apps/web

help:               ## List commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:[^#]*## /\t/' | column -t -s "$$(printf '\t')"

env:
	@[ -f .env ] || (cp .env.example .env && echo "Created .env from .env.example")

install: env        ## Install API (uv) and JS (pnpm) dependencies
	cd $(API_DIR) && uv sync
	pnpm install

dev: env            ## Start api + mariadb (web app: `make web` in another terminal)
	docker compose up --build

db: env             ## Start only mariadb in the background (pair with `make api`)
	docker compose up -d mariadb

api: env            ## Run the API on the host with auto-reload (no Docker needed; DB optional)
	cd $(API_DIR) && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

web:                ## Run the web app dev server on http://localhost:5173 (Vite)
	pnpm --filter web dev

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
	# TODO(Mick Ola): build order step 2. Export FastAPI OpenAPI to packages/contracts/openapi.json
	# and generate packages/contracts/ts from it. Generator tool not chosen yet (OPEN QUESTION).
	@echo "make contracts: not implemented yet (build order step 2)" && exit 1

nemotron-check:     ## Ping the Nemotron endpoint from .env (IMAGE=path.jpg to test vision)
	cd $(API_DIR) && PYTHONPATH=. uv run python ../../infra/scripts/nemotron_check.py $(IMAGE)

eval:               ## Page-analysis + grounding evaluation
	cd $(API_DIR) && uv run python ../../eval/run_eval.py
