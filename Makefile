.PHONY: dev down db api migrate test test-api test-mobile lint lint-api lint-mobile format contracts eval install env

API_DIR := apps/api
MOBILE_DIR := apps/mobile

env:
	@[ -f .env ] || (cp .env.example .env && echo "Created .env from .env.example")

install: env        ## Install API (uv) and JS (pnpm) dependencies
	cd $(API_DIR) && uv sync
	pnpm install

dev: env            ## Start api + mariadb (mobile dev server: `pnpm mobile` in another terminal)
	docker compose up --build

db: env             ## Start only mariadb in the background (pair with `make api`)
	docker compose up -d mariadb

api: env            ## Run the API on the host with auto-reload (no Docker needed; DB optional)
	cd $(API_DIR) && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

down:
	docker compose down

migrate:            ## alembic upgrade head (inside the api container)
	docker compose run --rm api alembic upgrade head

test: test-api test-mobile

test-api:
	cd $(API_DIR) && uv run pytest

test-mobile:
	pnpm --filter mobile test

lint: lint-api lint-mobile

lint-api:
	cd $(API_DIR) && uv run ruff check . && uv run ruff format --check .

lint-mobile:
	pnpm --filter mobile lint

format:             ## Auto-fix API lint and formatting
	cd $(API_DIR) && uv run ruff check --fix . && uv run ruff format .

contracts:          ## Regenerate openapi.json and TS types
	# TODO(Mick Ola): build order step 2. Export FastAPI OpenAPI to packages/contracts/openapi.json
	# and generate packages/contracts/ts from it. Generator tool not chosen yet (OPEN QUESTION).
	@echo "make contracts: not implemented yet (build order step 2)" && exit 1

eval:               ## Page-analysis + grounding evaluation
	cd $(API_DIR) && uv run python ../../eval/run_eval.py
