# Seed data

`demo_users.json`: 10 dummy readers for testing, with public-domain book metadata (no book
text), reading positions, word-bank words and a few weeks of reading events. Context sentences
are written for this file, not quoted from the books.

Load it with `apps/api/scripts/seed_demo.py` (run from `apps/api`; it writes to `DATABASE_URL`):

    uv run python -m scripts.seed_demo           # add (skips if already there)
    uv run python -m scripts.seed_demo --reset   # rebuild
    uv run python -m scripts.seed_demo --delete  # remove

Demo readers are the usernames starting with `demo_`; demo books have `metadata_source`
`demo_seed`. Loaded into the Aiven database on 2026-11-14.
