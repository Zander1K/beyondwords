"""Check that the Nemotron endpoint in .env answers. Run with `make nemotron-check`.

Optional: pass an image path to test vision, e.g. `make nemotron-check IMAGE=page.jpg`.
"""

import asyncio
import sys
from pathlib import Path

from app.brain.llm import LLMError, Message, get_llm, image_part, text_part


async def main(image: bytes | None) -> int:
    llm = get_llm()
    if image:
        content = [
            text_part("Read the first line of text on this page."),
            image_part(image),
        ]
    else:
        content = "Reply with exactly: Nemotron is reachable."
    try:
        reply = await llm.chat(
            [Message(role="user", content=content)], max_tokens=200, reasoning=False
        )
    except LLMError as exc:
        print(f"FAILED: {exc}")
        return 1
    print(f"OK ({reply.model}, {reply.latency_ms} ms): {reply.text.strip()}")
    return 0


if __name__ == "__main__":
    image = Path(sys.argv[1]).read_bytes() if len(sys.argv) > 1 else None
    sys.exit(asyncio.run(main(image)))
