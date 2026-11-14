"""POST /ocr/page: read the text in a camera frame with Google Cloud Vision.

The frame is the raw request body (JPEG or PNG), so the web app sends it in one fetch with no extra
dependency. The answer is lines and words with positions, in the same shape the on-device reader
produces. On any failure the route answers 503 "Reading is paused" and the web app reads on-device.
Frames are processed to serve the request and not stored (CLAUDE.md section 10).
"""

import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.ocr.google import GoogleVisionClient, OcrError, OcrErrorReason, get_vision_client
from app.ocr.mapping import annotation_to_lines
from app.schemas.ocr import OcrPageResponse, OcrStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ocr", tags=["ocr"])

Client = Annotated[GoogleVisionClient, Depends(get_vision_client)]

PAUSED_MESSAGE = "Reading is paused. Reading continues on this device."
# A 1600 px JPEG is a few hundred KB; this stops oversized uploads early.
MAX_IMAGE_BYTES = 6 * 1024 * 1024


@router.get("/status", response_model=OcrStatus)
async def ocr_status(client: Client) -> OcrStatus:
    """Whether Google Vision is set up, so the web app can choose its reader."""
    return OcrStatus(available=client.configured)


@router.post(
    "/page",
    response_model=OcrPageResponse,
    responses={503: {"description": PAUSED_MESSAGE}, 413: {"description": "Image too large"}},
)
async def read_page(request: Request, client: Client) -> OcrPageResponse:
    image = await request.body()
    if not image:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No image.")
    if len(image) > MAX_IMAGE_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "That image is too large.")
    started = time.perf_counter()
    try:
        annotation = await client.read(image)
    except OcrError as exc:
        if exc.reason is OcrErrorReason.BAD_IMAGE:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "That is not a readable image."
            ) from exc
        logger.info("Google Vision unavailable (%s): %s", exc.reason.value, exc.detail)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, PAUSED_MESSAGE) from exc
    lines, width, height, pages = annotation_to_lines(annotation)
    return OcrPageResponse(
        lines=lines,
        width=width,
        height=height,
        blocks=pages,
        ms=round((time.perf_counter() - started) * 1000),
    )
