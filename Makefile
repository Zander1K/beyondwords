.PHONY: dev down migrate test test-api test-mobile lint lint-api lint-mobile contracts eval install

API_DIR := apps/api
MOBILE_DIR := apps/mobile

install:            ## Install API (uv) and JS (pnpm) dependencies
	cd $(API_DIR) && uv sync
	pnpm install

dev:                ## Start api + postgres (mobile dev server: `pnpm mobile` in another terminal)
	@[ -f .env ] || (cp .env.example .env && echo "Created .env from .env.example")
	docker compose up --build

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

contracts:          ## Regenerate openapi.json and TS types
	# FastAPI -> packages/contracts/openapi.json -> packages/contracts/ts/schema.ts
	# (openapi-typescript). Commit both files; the app imports from @reading-companion/contracts.
	cd $(API_DIR) && uv run python -m scripts.export_openapi
	pnpm --filter @reading-companion/contracts generate

eval:               ## Page-analysis + grounding evaluation
	cd $(API_DIR) && uv run python ../../eval/run_eval.py
