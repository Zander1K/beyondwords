"""POST /illustrate and GET /illustrations/{id}. Thin layer over app.gemini.images."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.gemini.images import (
    IllustrationError,
    IllustrationErrorReason,
    IllustrationService,
    get_illustration_service,
)
from app.schemas.illustrations import IllustrateRequest, IllustrateResponse

router = APIRouter(tags=["illustrations"])

Service = Annotated[IllustrationService, Depends(get_illustration_service)]

# SOP section 9: one short line, and reading continues.
PAUSED_MESSAGE = "Illustrations are paused. Reading continues."


@router.post("/illustrate", response_model=IllustrateResponse)
async def illustrate(body: IllustrateRequest, service: Service) -> IllustrateResponse:
    try:
        result = await service.illustrate(body.text, body.setting_era)
    except IllustrationError as exc:
        if exc.reason is IllustrationErrorReason.NOT_ALLOWED:
            raise HTTPException(422, exc.detail) from exc
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, PAUSED_MESSAGE) from exc
    return IllustrateResponse(
        id=result.id,
        text=result.text,
        kind=result.kind.value,
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
