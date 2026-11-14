"""Versioned prompt files. Load with `load_prompt("page_analyzer.v1")`.

Bump the version (new file) rather than editing a prompt in place once eval numbers exist,
so before/after results stay comparable. Run `make eval` before switching versions.
"""

from functools import lru_cache
from pathlib import Path

_DIR = Path(__file__).parent


@lru_cache
def load_prompt(name: str) -> str:
    return (_DIR / f"{name}.md").read_text(encoding="utf-8").strip()
