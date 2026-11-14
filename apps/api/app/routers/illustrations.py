"""POST /illustrate and GET /illustrations/{id}. Thin layer over app.gemini.images."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.books.library import Library
from app.gemini.context import load_book_context
from app.gemini.images import (
    IllustrationError,
    IllustrationErrorReason,
    IllustrationService,
    get_illustration_service,
)
from app.routers.books import get_library
from app.schemas.illustrations import IllustrateRequest, IllustrateResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["illustrations"])

Service = Annotated[IllustrationService, Depends(get_illustration_service)]

# SOP section 9: one short line, and reading continues.
PAUSED_MESSAGE = "Illustrations are paused. Reading continues."


@router.post(
    "/illustrate",
    response_model=IllustrateResponse,
    responses={
        422: {
            "description": "Not one word/phrase/sentence, or better explained than pictured. "
            "`detail` is a short reason the app can speak."
        },  # fmt: skip
        503: {"description": PAUSED_MESSAGE},
    },
)
async def illustrate(
    body: IllustrateRequest,
    service: Service,
    library: Annotated[Library, Depends(get_library)],
) -> IllustrateResponse:
    book = await load_book_context(library, body.book_id)
    try:
        result = await service.illustrate(body.text, body.setting_era, book)
    except IllustrationError as exc:
        if exc.reason in (
            IllustrationErrorReason.NOT_ALLOWED,
            IllustrationErrorReason.NOT_SUITABLE,
        ):
            # Say which text and why, so a 422 in the log is not a mystery.
            logger.info(
                "Illustration declined (%s) for %r: %s", exc.reason.value, body.text, exc.detail
            )
            raise HTTPException(422, exc.detail) from exc
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, PAUSED_MESSAGE) from exc
    return IllustrateResponse(
        id=result.id,
        text=result.text,
        kind=result.kind.value,
        scene=result.scene or result.text,
        planned=result.planned,
        mime_type=result.mime_type,
        url=f"/illustrations/{result.id}",
    )


@router.get(
    "/illustrations/{image_id}",
    response_class=Response,
    responses={200: {"content": {"image/png": {}, "image/jpeg": {}}}},
)
async def get_illustration(image_id: str, service: Service) -> Response:
    result = service.get(image_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Illustration not found or expired")
    return Response(
        content=result.data,
        media_type=result.mime_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )
