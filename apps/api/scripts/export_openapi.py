"""Write the FastAPI OpenAPI schema to packages/contracts/openapi.json (`make contracts`).

Needs no API keys or database: it only imports the app and reads its routes and models.
"""

import json
import sys
from pathlib import Path

from app.main import app

OUT = Path(__file__).resolve().parents[3] / "packages/contracts/openapi.json"


def main() -> None:
    schema = app.openapi()
    OUT.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {OUT} ({len(schema.get('paths', {}))} paths)", file=sys.stderr)


if __name__ == "__main__":
    main()
