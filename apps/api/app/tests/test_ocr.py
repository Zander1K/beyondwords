"""Google Cloud Vision reading: the mapping to lines and words, the client and the /ocr routes.
A made-up Vision response and a fake Google (no network, no cost, no real text)."""

from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.ocr.google import GoogleVisionClient, OcrError, OcrErrorReason, get_vision_client
from app.ocr.mapping import annotation_to_lines

W, H = 1000, 1000


def word(text: str, x: int, y: int, w: int, h: int, brk: str | None = None, tilt: int = 0) -> dict:
    """A Vision word: corners TL, TR, BR, BL; `tilt` lowers the right edge (a sloped line)."""
    last: dict[str, Any] = {"text": text[-1]}
    if brk:
        last["property"] = {"detectedBreak": {"type": brk}}
    return {
        "symbols": [*({"text": c} for c in text[:-1]), last],
        "confidence": 0.9,
        "boundingBox": {
            "vertices": [
                {"x": x, "y": y},
                {"x": x + w, "y": y + tilt},
                {"x": x + w, "y": y + h + tilt},
                {"x": x, "y": y + h},
            ]
        },
    }


def annotation(words: list[dict], width: int = W, height: int = H) -> dict:
    return {
        "fullTextAnnotation": {
            "pages": [
                {
                    "width": width,
                    "height": height,
                    "blocks": [{"paragraphs": [{"words": words}]}],
                }
            ]
        }
    }


def test_lines_are_rebuilt_from_the_break_markers_with_words_and_offsets() -> None:
    a = annotation(
        [
            word("Mira", 100, 100, 80, 30),
            word("lived", 190, 100, 90, 30, "EOL_SURE_SPACE"),
            word("at", 100, 150, 40, 30),
            word("home.", 150, 150, 100, 30, "LINE_BREAK"),
        ]
    )
    lines, width, height, pages = annotation_to_lines(a)
    assert (width, height, pages) == (1000, 1000, 1)
    assert [ln.text for ln in lines] == ["Mira lived", "at home."]
    first = lines[0]
    assert [(w.text, w.start, w.end) for w in first.words] == [("Mira", 0, 4), ("lived", 5, 10)]
    # Normalised boxes and a baseline from the first word's left to the last one's right.
    assert first.words[0].box.x == pytest.approx(0.1)
    assert first.box.w == pytest.approx(0.18)
    assert first.baseline.x0 == pytest.approx(0.1)
    assert first.baseline.x1 == pytest.approx(0.28)
    assert first.baseline.y0 == pytest.approx((100 + 0.78 * 30) / 1000)
    assert first.baseline.height == pytest.approx(0.03)
    assert first.confidence == pytest.approx(90)


def test_a_sloped_line_gets_a_sloped_baseline() -> None:
    a = annotation(
        [
            word("one", 100, 100, 100, 30, tilt=10),
            word("two", 210, 110, 100, 30, "LINE_BREAK", tilt=10),
        ]
    )
    (line,), *_ = annotation_to_lines(a)
    assert line.baseline.y1 > line.baseline.y0
    assert line.baseline.bow == pytest.approx(0, abs=0.02)


def test_a_bowed_line_says_how_much_it_sags() -> None:
    # Five words; the middle ones sit lower than the ends: a line that bows down in the middle.
    ys = [100, 112, 118, 112, 100]
    words = [word(f"w{i}", 100 + i * 100, y, 90, 30) for i, y in enumerate(ys)]
    words[-1]["symbols"][-1]["property"] = {"detectedBreak": {"type": "LINE_BREAK"}}
    (line,), *_ = annotation_to_lines(annotation(words))
    assert line.baseline.bow > 0.005


def test_specks_are_dropped_and_lines_come_out_top_to_bottom() -> None:
    a = annotation(
        [
            word("second", 100, 300, 100, 30, "LINE_BREAK"),
            word("7", 480, 900, 20, 30, "LINE_BREAK"),  # a page number
            word("first", 100, 100, 100, 30, "LINE_BREAK"),
        ]
    )
    lines, *_ = annotation_to_lines(a)
    assert [ln.text for ln in lines] == ["first", "second"]


def test_an_open_book_is_split_into_two_pages_left_then_right() -> None:
    words = []
    for row in range(3):
        y = 100 + row * 60
        words.append(word(f"left{row}", 80, y, 300, 30, "LINE_BREAK"))
        words.append(word(f"right{row}", 560, y, 300, 30, "LINE_BREAK"))
    lines, _, _, pages = annotation_to_lines(annotation(words))
    assert pages == 2
    assert [(ln.block, ln.text) for ln in lines] == [
        (0, "left0"),
        (0, "left1"),
        (0, "left2"),
        (1, "right0"),
        (1, "right1"),
        (1, "right2"),
    ]


def test_a_single_page_stays_one_page() -> None:
    words = [word(f"line{i}", 100, 100 + i * 60, 700, 30, "LINE_BREAK") for i in range(5)]
    assert annotation_to_lines(annotation(words))[3] == 1


def test_nothing_found_is_an_empty_page() -> None:
    assert annotation_to_lines({}) == ([], 0, 0, 0)


# --- client and routes -----------------------------------------------------------------------


def _client(
    handler: Callable[[httpx.Request], httpx.Response], key: str = "k"
) -> GoogleVisionClient:
    return GoogleVisionClient(
        api_key=key, http=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )


async def test_client_sends_the_frame_and_returns_the_annotation() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.url.params["key"]
        seen["feature"] = httpx.Response(200, content=request.content).json()["requests"][0][
            "features"
        ]
        return httpx.Response(200, json={"responses": [annotation([word("hi", 1, 1, 5, 5)])]})

    result = await _client(handler).read(b"jpeg")
    assert "fullTextAnnotation" in result
    assert seen["key"] == "k"
    assert seen["feature"] == [{"type": "DOCUMENT_TEXT_DETECTION"}]


@pytest.mark.parametrize(
    ("status", "reason"),
    [
        (403, OcrErrorReason.FORBIDDEN),
        (429, OcrErrorReason.RATE_LIMITED),
        (400, OcrErrorReason.BAD_IMAGE),
        (500, OcrErrorReason.FAILED),
    ],
)
async def test_client_errors_become_ocr_errors(status: int, reason: OcrErrorReason) -> None:
    with pytest.raises(OcrError) as exc:
        await _client(lambda r: httpx.Response(status, text="no")).read(b"x")
    assert exc.value.reason is reason


async def test_no_key_does_not_call_google() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("must not call Google without a key")

    with pytest.raises(OcrError) as exc:
        await _client(handler, key="").read(b"x")
    assert exc.value.reason is OcrErrorReason.NOT_CONFIGURED


@pytest.fixture
def use() -> Iterator[Callable[[GoogleVisionClient], None]]:
    def _use(client: GoogleVisionClient) -> None:
        app.dependency_overrides[get_vision_client] = lambda: client

    yield _use
    app.dependency_overrides.clear()


async def _post(path: str, **kwargs: Any) -> httpx.Response:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post(path, **kwargs)


async def test_page_route_returns_lines(use: Callable[[GoogleVisionClient], None]) -> None:
    use(
        _client(
            lambda r: httpx.Response(
                200, json={"responses": [annotation([word("hello", 10, 10, 80, 20, "LINE_BREAK")])]}
            )
        )
    )
    r = await _post("/ocr/page", content=b"jpegbytes", headers={"content-type": "image/jpeg"})
    assert r.status_code == 200
    body = r.json()
    assert body["lines"][0]["text"] == "hello"
    assert body["lines"][0]["words"][0]["box"]["w"] == pytest.approx(0.08)
    assert (body["width"], body["height"], body["blocks"]) == (1000, 1000, 1)


async def test_page_route_503_when_google_is_unavailable_and_422_for_no_image(
    use: Callable[[GoogleVisionClient], None],
) -> None:
    use(_client(lambda r: httpx.Response(403, text="billing")))
    r = await _post("/ocr/page", content=b"x")
    assert r.status_code == 503 and "paused" in r.json()["detail"].lower()
    assert (await _post("/ocr/page", content=b"")).status_code == 422


async def test_status_route_says_whether_a_key_is_set(
    use: Callable[[GoogleVisionClient], None],
) -> None:
    use(_client(lambda r: httpx.Response(200), key="k"))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get("/ocr/status")).json() == {"available": True}
        use(_client(lambda r: httpx.Response(200), key=""))
        assert (await c.get("/ocr/status")).json() == {"available": False}
