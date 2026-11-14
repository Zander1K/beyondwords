"""Fallback reading order on tilted and two-column pages, and the word-level OCR check."""

import math

from app.brain import geometry as geo
from app.brain.page_analyzer import PageDraft, fallback_page, repair
from app.brain.text_utils import word_differences
from app.brain.tools.define import define_word
from app.schemas.page import OcrLine
from app.tests.brain_fakes import FakeLLM

TEXT = [
    "Sir Bors was exhausted when he reached the",
    "castle at dusk. Above the gatehouse, the",
    "portcullis groaned upward on its rusted chains,",
    "and a sentry in a battered surcoat waved him",
    "through without a word.",
]


def _tilted(x: float, y: float) -> tuple[float, float]:
    """A real perspective view: rotated 14 degrees and receding (top edge further away)."""
    a = math.radians(14)
    xr = math.cos(a) * (x - 0.5) - math.sin(a) * (y - 0.5)
    yr = math.sin(a) * (x - 0.5) + math.cos(a) * (y - 0.5)
    w = 1 + 0.35 * yr
    return (0.5 + 0.8 * xr / w, 0.5 + 0.8 * yr / w)


def _tilted_lines() -> list[OcrLine]:
    lines = []
    for i, text in enumerate(TEXT):
        y0, y1, x1 = 0.1 + i * 0.06, 0.14 + i * 0.06, 0.1 + len(text) * 0.017
        quad = [list(_tilted(x, y)) for x, y in ((0.1, y0), (x1, y0), (x1, y1), (0.1, y1))]
        xs, ys = [p[0] for p in quad], [p[1] for p in quad]
        bbox = [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)]
        lines.append(OcrLine(id=f"L{i + 1}", text=text, bbox=bbox, quad=quad))
    return lines


def test_fallback_reads_columns_one_at_a_time() -> None:
    def line(i: str, x: float, y: float) -> OcrLine:
        return OcrLine(id=i, text=f"text of {i}", bbox=[x, y, 0.42, 0.04])

    lines = [
        line("L1", 0.05, 0.1),
        line("R1", 0.53, 0.1),
        line("L2", 0.05, 0.15),
        line("R2", 0.53, 0.15),
        OcrLine(id="head", text="A heading across the page", bbox=[0.05, 0.03, 0.9, 0.04]),
    ]
    assert fallback_page("p3", lines).reading_order == ["head", "L1", "L2", "R1", "R2"]


def test_fallback_order_on_a_tilted_receding_page() -> None:
    assert geo.visual_order(list(reversed(_tilted_lines()))) == ["L1", "L2", "L3", "L4", "L5"]


def test_one_wrong_word_in_a_long_line_is_a_disagreement() -> None:
    # A whole-line similarity threshold missed this: the lines are 98% similar.
    ocr_text = "portcullis groaned upward on its busted chains,"
    assert word_differences(ocr_text, TEXT[2]) == [("busted", "rusted")]
    assert word_differences("The Gate, opened.", "the gate opened") == []

    lines = [OcrLine(id="L3", text=ocr_text, bbox=[0.1, 0.2, 0.8, 0.04])]
    draft = PageDraft(reading_order=["L3"], lines=[{"id": "L3", "text": TEXT[2]}])
    analysis = repair("p12", draft, lines, compare_text=True)
    assert [d.line for d in analysis.ocr_disagreements] == ["L3"]


async def test_define_word_keeps_the_word_as_printed() -> None:
    llm = FakeLLM({"word": "groan", "say_as": "GROAND", "meaning": "made a low sound"})
    got = await define_word("groaned,", "The portcullis groaned upward.", llm=llm)
    assert got.word == "groaned" and "".join(got.syllables) == "groaned"
