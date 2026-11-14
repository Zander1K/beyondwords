# contracts

Shared source of truth for API types.

- `openapi.json`: generated from the FastAPI app, committed.
- `ts/`: TypeScript types generated from `openapi.json` for the web app (`apps/web`).

TODO(Mick Ola): build order step 2, `make contracts`. OPEN QUESTION: TS generator (e.g. openapi-typescript) not chosen yet.
