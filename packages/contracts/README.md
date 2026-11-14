# contracts

Shared source of truth for API types. Regenerate with `make contracts` after any API schema
change, and commit the result.

- `openapi.json`: exported from the FastAPI app (`apps/api/scripts/export_openapi.py`).
- `ts/schema.ts`: generated from `openapi.json` by openapi-typescript 7.13. Never edit by hand.
- `ts/index.ts`: friendly type names (e.g. `IllustrateRequest`), hand-written.

Use from the apps: `import type { IllustrateResponse } from "@reading-companion/contracts";`
(add `"@reading-companion/contracts": "workspace:*"` to the app's dependencies).
