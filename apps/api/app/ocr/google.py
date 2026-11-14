"""A small async client for Google Cloud Vision's text detection (images:annotate).

Privacy (CLAUDE.md section 10): the camera frame is sent to Google to be read, and nothing is
stored here. The key stays on the server.

Failures raise `OcrError` with a reason, so the route can say "reading is paused" and the web app
can fall back to reading on-device instead of stopping.
"""

import base64
import logging
from enum import StrEnum
from functools import lru_cache
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

URL = "https://vision.googleapis.com/v1/images:annotate"


class OcrErrorReason(StrEnum):
    NOT_CONFIGURED = "not_configured"  # no API key
    FORBIDDEN = "forbidden"  # key refused: Vision API not enabled, billing off, or key restricted
    RATE_LIMITED = "rate_limited"
    TIMEOUT = "timeout"
    BAD_IMAGE = "bad_image"
    FAILED = "failed"


class OcrError(Exception):
    def __init__(self, reason: OcrErrorReason, detail: str = "") -> None:
        super().__init__(detail or reason.value)
        self.reason = reason
        self.detail = detail or reason.value


class GoogleVisionClient:
    def __init__(
        self, *, api_key: str, timeout: float = 12.0, http: httpx.AsyncClient | None = None
    ) -> None:
        self._key = api_key
        self._http = http or httpx.AsyncClient(timeout=timeout)

    @property
    def configured(self) -> bool:
        return bool(self._key)

    async def read(self, image: bytes) -> dict[str, Any]:
        """Vision's annotation for an image (`DOCUMENT_TEXT_DETECTION`: best for pages of text)."""
        if not self._key:
            raise OcrError(OcrErrorReason.NOT_CONFIGURED, "GOOGLE_VISION_API_KEY is not set")
        body = {
            "requests": [
                {
                    "image": {"content": base64.b64encode(image).decode("ascii")},
                    "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
                    "imageContext": {"languageHints": ["en"]},
                }
            ]
        }
        try:
            # The key travels in the query string (Vision's API-key auth); never log the URL.
            response = await self._http.post(URL, params={"key": self._key}, json=body)
        except httpx.TimeoutException as exc:
            raise OcrError(OcrErrorReason.TIMEOUT) from exc
        except httpx.HTTPError as exc:
            raise OcrError(OcrErrorReason.FAILED, type(exc).__name__) from exc
        if response.status_code == 429:
            raise OcrError(OcrErrorReason.RATE_LIMITED)
        if response.status_code in (401, 403):
            # The message says what to enable (the API, billing) and never contains the key.
            logger.warning("Google Vision refused the request: %s", response.text[:300])
            raise OcrError(OcrErrorReason.FORBIDDEN)
        if response.status_code == 400:
            raise OcrError(OcrErrorReason.BAD_IMAGE)
        if response.status_code >= 400:
            raise OcrError(OcrErrorReason.FAILED, f"Google answered {response.status_code}")
        first = (response.json().get("responses") or [{}])[0]
        if first.get("error"):
            raise OcrError(OcrErrorReason.FAILED, str(first["error"].get("message", ""))[:120])
        return first


@lru_cache
def get_vision_client() -> GoogleVisionClient:
    s = get_settings()
    return GoogleVisionClient(
        api_key=s.google_vision_api_key, timeout=s.google_vision_timeout_seconds
    )
