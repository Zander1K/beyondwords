"""Gemini image generation as the brain's `Illustrator` (brain/tools/store.py).

The reading-coach agent (Nemotron) decides when a picture helps and calls its `illustrate` tool;
this adapter draws it with IllustrationService and returns the URL the phone fetches.
"""

import logging

from app.gemini.context import BookContext
from app.gemini.images import IllustrationError, IllustrationService

logger = logging.getLogger(__name__)


class GeminiIllustrator:
    def __init__(self, service: IllustrationService, book: BookContext | None = None) -> None:
        self._service = service
        self._book = book

    async def illustrate(self, concept: str, style_hint: str | None = None) -> str | None:
        """URL of a picture of `concept`, or None when it should not or cannot be drawn."""
        try:
            result = await self._service.illustrate(
                concept, setting_era=style_hint, book=self._book
            )
        except IllustrationError as exc:
            logger.info("illustrate for the brain failed: %s", exc.reason)
            return None
        return f"/illustrations/{result.id}"
