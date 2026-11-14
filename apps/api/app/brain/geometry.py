"""Visual reading order from OCR geometry, for when Nemotron is unavailable (fallback_page)
or leaves lines out of its reading order.

Coordinates are normalised 0-1 of the photo, top-left origin. The glasses see pages at an
angle, so lines are sorted in the page's own frame (along and down the text, from the lines'
corner points when the phone sends `quad`) and columns are read one at a time, instead of
sorting by image y, which interleaves two columns and mis-orders slanted lines.
"""

import math
from statistics import median

from app.schemas.page import OcrLine

Vec = tuple[float, float]
Corners = tuple[Vec, Vec, Vec, Vec]  # top-left, top-right, bottom-right, bottom-left


def corners(item: OcrLine) -> Corners:
    """The item's quad if the phone sent one, else the corners of its upright bbox."""
    if item.quad:
        tl, tr, br, bl = ((p[0], p[1]) for p in item.quad)
        return (tl, tr, br, bl)
    x, y, w, h = item.bbox
    return ((x, y), (x + w, y), (x + w, y + h), (x, y + h))


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1])


def _cross(a: Vec, b: Vec) -> float:
    return a[0] * b[1] - a[1] * b[0]


def _unit(v: Vec) -> Vec:
    n = math.hypot(*v)
    return (v[0] / n, v[1] / n) if n else (0.0, 0.0)


def page_axes(items: list[Corners]) -> tuple[Vec, Vec]:
    """Median 'along the text' and 'down the page' directions over all lines."""
    along = [_unit(_sub(tr, tl)) for tl, tr, _, _ in items]
    down = [_unit(_sub(bl, tl)) for tl, _, _, bl in items]
    u = (median(v[0] for v in along), median(v[1] for v in along))
    d = (median(v[0] for v in down), median(v[1] for v in down))
    if abs(_cross(u, d)) < 1e-6:  # degenerate: fall back to the image axes
        return (1.0, 0.0), (0.0, 1.0)
    return u, d


def to_page_coords(p: Vec, u: Vec, d: Vec) -> Vec:
    """(along, down) coordinates of p in the page's own frame: p = along * u + down * d."""
    det = _cross(u, d)
    return (_cross(p, d) / det, _cross(u, p) / det)


def visual_order(lines: list[OcrLine]) -> list[str]:
    """Reading order from geometry alone: down the page, one column at a time.

    Lines wider than 60% of the text block (headings, single-column text) are read in place and
    split the page into sections; within a section, gutters with no text start new columns.
    """
    if not lines:
        return []
    cs = {line.id: corners(line) for line in lines}
    u, d = page_axes(list(cs.values()))
    boxes: dict[str, tuple[float, float, float, float]] = {}
    for line_id, c in cs.items():
        pts = [to_page_coords(p, u, d) for p in c]
        boxes[line_id] = (
            min(p[0] for p in pts),
            max(p[0] for p in pts),
            min(p[1] for p in pts),
            max(p[1] for p in pts),
        )
    left = min(b[0] for b in boxes.values())
    width = max(b[1] for b in boxes.values()) - left or 1.0
    line_h = median(b[3] - b[2] for b in boxes.values()) or 0.01
    by_down = sorted(boxes, key=lambda i: ((boxes[i][2] + boxes[i][3]) / 2, boxes[i][0]))

    order: list[str] = []
    section: list[str] = []

    def flush() -> None:
        if not section:
            return
        spans = sorted((boxes[i][0], boxes[i][1]) for i in section)
        columns = [list(spans[0])]
        for a0, a1 in spans[1:]:
            if a0 - columns[-1][1] > max(0.5 * line_h, 0.015 * width):
                columns.append([a0, a1])
            else:
                columns[-1][1] = max(columns[-1][1], a1)

        def column_of(line_id: str) -> int:
            mid = (boxes[line_id][0] + boxes[line_id][1]) / 2
            return min(
                range(len(columns)),
                key=lambda k: (
                    0
                    if columns[k][0] <= mid <= columns[k][1]
                    else 1 + min(abs(mid - columns[k][0]), abs(mid - columns[k][1]))
                ),
            )

        order.extend(sorted(section, key=lambda i: (column_of(i), section.index(i))))
        section.clear()

    for line_id in by_down:
        a0, a1, _, _ = boxes[line_id]
        if (a1 - a0) > 0.6 * width:
            flush()
            order.append(line_id)
        else:
            section.append(line_id)
    flush()
    return order
