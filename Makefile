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
	# TODO(Mick Ola): build order step 2. Export FastAPI OpenAPI to packages/contracts/openapi.json
	# and generate packages/contracts/ts from it. Generator tool not chosen yet (OPEN QUESTION).
	@echo "make contracts: not implemented yet (build order step 2)" && exit 1

eval:               ## Page-analysis + grounding evaluation
	cd $(API_DIR) && uv run python ../../eval/run_eval.py
