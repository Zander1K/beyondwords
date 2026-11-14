"""Google Cloud Vision's answer -> our lines and words.

Vision returns page > block > paragraph > word > symbol, each word with a four-corner polygon
(top-left, top-right, bottom-right, bottom-left, in the text's own direction, so a sloped line has
sloped words) and no "line" level. Lines are rebuilt from the break markers Vision puts on the last
symbol of a word (LINE_BREAK, EOL_SURE_SPACE), and each line gets the same geometry the on-device
reader gives: a box, a baseline from end to end, the text height and how much it bows.
Pure functions, no network.
"""

import math
from typing import Any

from app.schemas.ocr import Baseline, Box, LineOut, WordOut

# Where the baseline sits within a word's box, from its top (descenders hang below it).
BASELINE_AT = 0.78
LINE_ENDS = {"LINE_BREAK", "EOL_SURE_SPACE"}
# The gutter must be at least this share of the width to call it a two-page spread (a photo of
# curled pages can have a narrow one), and each side must hold this share of the lines.
MIN_PAGE_GAP = 0.015
MIN_PAGE_SHARE = 0.25

Point = tuple[float, float]


def _word_text(word: dict[str, Any]) -> str:
    return "".join(s.get("text", "") for s in word.get("symbols", []))


def _ends_line(word: dict[str, Any]) -> bool:
    symbols = word.get("symbols") or [{}]
    brk = (symbols[-1].get("property") or {}).get("detectedBreak") or {}
    return brk.get("type") in LINE_ENDS


def _corners(word: dict[str, Any], width: int, height: int) -> list[Point] | None:
    vertices = (word.get("boundingBox") or {}).get("vertices") or []
    if len(vertices) != 4:
        return None
    # Vision leaves out a coordinate that is 0.
    return [(v.get("x", 0) / width, v.get("y", 0) / height) for v in vertices]


def _lerp(a: Point, b: Point, t: float) -> Point:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _bounds(points: list[Point]) -> Box:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return Box(x=min(xs), y=min(ys), w=max(xs) - min(xs), h=max(ys) - min(ys))


def _bow(b0: Point, b1: Point, left: list[Point], right: list[Point]) -> float:
    """How much a line sags at its middle (negative = bows up), as the reader models it:
    y = chord + bow * 4t(1-t), t = 0..1 along the line. Fitted through every word's baseline, so
    one badly placed word does not decide it. Needs a few words to say anything."""
    span = b1[0] - b0[0]
    if len(left) < 4 or abs(span) < 1e-9:
        return 0.0
    # Each word's baseline middle, as (t along the line, its distance below the straight chord).
    pts: list[tuple[float, float]] = []
    for lp, rp in zip(left, right, strict=True):
        x, y = (lp[0] + rp[0]) / 2, (lp[1] + rp[1]) / 2
        t = (x - b0[0]) / span
        pts.append((t, y - (b0[1] + (b1[1] - b0[1]) * t)))
    # Least squares for dy = bow * 4t(1-t): one unknown, so it is a ratio of sums.
    num = sum(4 * t * (1 - t) * dy for t, dy in pts)
    den = sum((4 * t * (1 - t)) ** 2 for t, _ in pts)
    return num / den if den > 1e-12 else 0.0


def _line(words: list[dict[str, Any]], width: int, height: int) -> LineOut | None:
    shaped: list[tuple[str, list[Point], float]] = []
    for w in words:
        text = _word_text(w)
        corners = _corners(w, width, height)
        if text and corners:
            shaped.append((text, corners, float(w.get("confidence", 0.0))))
    if not shaped:
        return None

    out_words: list[WordOut] = []
    text = ""
    for t, corners, _ in shaped:
        if text:
            text += " "
        start = len(text)
        text += t
        out_words.append(WordOut(text=t, box=_bounds(corners), start=start, end=len(text)))

    # Baseline: along the bottom of the text, from the first word's left to the last one's right.
    left_base = [_lerp(c[0], c[3], BASELINE_AT) for _, c, _ in shaped]
    right_base = [_lerp(c[1], c[2], BASELINE_AT) for _, c, _ in shaped]
    b0, b1 = left_base[0], right_base[-1]
    # Text height: the average word's top-to-bottom edge.
    heights = [math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]) for _, c, _ in shaped]
    text_height = sum(heights) / len(heights)

    bow = _bow(b0, b1, left_base, right_base)

    all_points = [p for _, c, _ in shaped for p in c]
    confidence = 100 * sum(c for _, _, c in shaped) / len(shaped)
    return LineOut(
        text=text,
        box=_bounds(all_points),
        baseline=Baseline(x0=b0[0], y0=b0[1], x1=b1[0], y1=b1[1], height=text_height, bow=bow),
        words=out_words,
        confidence=confidence,
        block=0,
    )


def _split_pages(lines: list[LineOut]) -> int:
    """Give each line its page (0 = left, 1 = right) when the lines fall into two columns with a
    clear gap between them (an open book). Returns how many pages were found."""
    if len(lines) < 4:
        return 1 if lines else 0
    spans = sorted((ln.box.x, ln.box.x + ln.box.w) for ln in lines)
    # The widest stretch with no text across it, near the middle.
    best_gap, best_at = 0.0, 0.5
    reach = spans[0][1]
    for left, right in spans[1:]:
        gap = left - reach
        if gap > best_gap and 0.25 < (left + reach) / 2 < 0.75:
            best_gap, best_at = gap, (left + reach) / 2
        reach = max(reach, right)
    if best_gap < MIN_PAGE_GAP:
        return 1
    sides = [(ln.box.x + ln.box.w / 2) >= best_at for ln in lines]
    right = sum(sides)
    if min(right, len(lines) - right) < MIN_PAGE_SHARE * len(lines):
        return 1  # a few stray lines past a gap, not a second page
    for ln, is_right in zip(lines, sides, strict=True):
        ln.block = 1 if is_right else 0
    return 2


def annotation_to_lines(annotation: dict[str, Any]) -> tuple[list[LineOut], int, int, int]:
    """(lines in reading order, image width, image height, pages) from a Vision response."""
    pages = (annotation.get("fullTextAnnotation") or {}).get("pages") or []
    if not pages:
        return [], 0, 0, 0
    page = pages[0]
    width, height = int(page.get("width") or 0), int(page.get("height") or 0)
    if width <= 0 or height <= 0:
        return [], 0, 0, 0

    lines: list[LineOut] = []
    for block in page.get("blocks", []):
        for paragraph in block.get("paragraphs", []):
            current: list[dict[str, Any]] = []
            for word in paragraph.get("words", []):
                current.append(word)
                if _ends_line(word):
                    line = _line(current, width, height)
                    if line:
                        lines.append(line)
                    current = []
            if current:  # a paragraph's last line may carry no break marker
                line = _line(current, width, height)
                if line:
                    lines.append(line)

    # Drop specks: a "line" with under two letters is a page number, an ornament or noise.
    lines = [ln for ln in lines if sum(ch.isalpha() for ch in ln.text) >= 2]
    pages_found = _split_pages(lines)
    # Reading order: page by page, then top to bottom.
    lines.sort(key=lambda ln: (ln.block, ln.baseline.y0 + (ln.baseline.y1 - ln.baseline.y0) / 2))
    return lines, width, height, pages_found
