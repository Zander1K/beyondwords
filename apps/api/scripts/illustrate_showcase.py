"""Run the real-book illustration examples through the illustration service with real Gemini.

Usage (from apps/api, with GEMINI_API_KEY in .env):

    uv run python scripts/illustrate_showcase.py OUTPUT_DIR

Reads scripts/illustrate_examples.json and calls the same service POST /illustrate uses, with the
example's book (title, author, year, era) as context, so no database or server is needed. Saves
each picture plus results.json (input, book, kind, planned scene, prompt, timing, outcome) to
OUTPUT_DIR. Each run makes about 18 planner calls and 18 image calls, so keep runs occasional
(hackathon quota). Never prints the API key.
"""

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.gemini.context import BookContext  # noqa: E402
from app.gemini.images import (  # noqa: E402
    IllustrationError,
    IllustrationErrorReason,
    build_prompt,
    classify_text,
    get_illustration_service,
)

EXAMPLES = Path(__file__).with_name("illustrate_examples.json")
STATUS = {IllustrationErrorReason.NOT_ALLOWED: 422, IllustrationErrorReason.NOT_SUITABLE: 422}


async def run(data: dict) -> tuple[list[dict], dict[str, bytes]]:
    """Illustrate every example; return result rows and image bytes by file name."""
    service = get_illustration_service()
    results: list[dict] = []
    images: dict[str, bytes] = {}
    for n, example in enumerate(data["examples"], 1):
        book = data["books"][example["book"]]
        context = BookContext(
            title=book["title"],
            author=book["author"],
            publication_year=book["year"],
            setting_era=book["setting_era"],
        )
        row = {**example, "n": n, "book": book}
        start = time.perf_counter()
        try:
            result = await service.illustrate(example["text"], book=context)
        except IllustrationError as exc:
            row |= {"status": STATUS.get(exc.reason, 503), "outcome": str(exc.reason),
                    "detail": exc.detail}  # fmt: skip
        else:
            ext = "jpg" if "jpeg" in result.mime_type else "png"
            row |= {
                "status": 200,
                "outcome": "drawn",
                "kind": result.kind.value,
                "id": result.id,
                "scene": result.scene,
                "planned": result.planned,
                "prompt": build_prompt(
                    result.text, result.kind, book["setting_era"],
                    result.scene if result.planned else None,
                ),
                "file": f"{n:02d}.{ext}",
            }  # fmt: skip
            images[row["file"]] = result.data
        row["ms"] = round((time.perf_counter() - start) * 1000)
        if row["status"] != 200 and "kind" not in row:
            try:
                row["kind"] = classify_text(example["text"])[1].value
            except IllustrationError:
                row["kind"] = None
        results.append(row)
        print(f"{n:2d} {example['group']:8s} {row['status']} {row['outcome']:12s} "
              f"{row['ms']:5d} ms  {example['text'][:40]!r}")  # fmt: skip
    return results, images


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: uv run python scripts/illustrate_showcase.py OUTPUT_DIR")
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    results, images = asyncio.run(run(json.loads(EXAMPLES.read_text(encoding="utf-8"))))
    for name, content in images.items():
        (out / name).write_bytes(content)
    (out / "results.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"Saved {len(images)} images to {out}")


if __name__ == "__main__":
    main()
