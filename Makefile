.PHONY: help nemotron-check dev down db api migrate test test-api test-mobile lint lint-api lint-mobile format contracts eval install env
.DEFAULT_GOAL := help

API_DIR := apps/api
MOBILE_DIR := apps/mobile

help:               ## List commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:[^#]*## /\t/' | column -t -s "$$(printf '\t')"

env:
	@[ -f .env ] || (cp .env.example .env && echo "Created .env from .env.example")

install: env        ## Install API (uv) and JS (pnpm) dependencies
	cd $(API_DIR) && uv sync
	pnpm install

dev: env            ## Start api + postgres (mobile dev server: `pnpm mobile` in another terminal)
	docker compose up --build

db: env             ## Start only postgres in the background (pair with `make api`)
	docker compose up -d postgres

api: env            ## Run the API on the host with auto-reload (no Docker needed; DB optional)
	cd $(API_DIR) && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

down:               ## Stop the docker compose stack
	docker compose down

migrate:            ## alembic upgrade head (inside the api container)
	docker compose run --rm api alembic upgrade head

test: test-api test-mobile   ## pytest (api) + jest (mobile)

test-api:
	cd $(API_DIR) && uv run pytest

test-mobile:
	pnpm --filter mobile test

lint: lint-api lint-mobile   ## ruff (api) + eslint (mobile)

lint-api:
	cd $(API_DIR) && uv run ruff check . && uv run ruff format --check .

lint-mobile:
	pnpm --filter mobile lint

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
