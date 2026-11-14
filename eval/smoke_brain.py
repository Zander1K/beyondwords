"""End-to-end smoke test of every brain job against the live model. Run before a demo:

    cd apps/api && uv run python ../../eval/smoke_brain.py [--save-images DIR]

Renders a book page (original sample text, not from any book), "photographs" it tilted and
receding with a finger in frame, derives the OCR lines and corner points the phone would send,
then runs: page analysis (with the photo), the OCR cross-check, the meaning of a word the phone
says is pointed at, questions as speech-to-text (misheard words, "this word", a spoiler, a
follow-up), Everyday mode, and the model-down paths. Picking the pointed word is the phone's job
and is not tested here.
Prints one line per check and exits non-zero if any fail. Nothing is stored.
"""

import argparse
import asyncio
import io
import json
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "apps" / "api"))

from app.brain import agent, document_reasoner, page_analyzer  # noqa: E402
from app.brain.llm import LLMError, Message, get_llm  # noqa: E402
from app.brain.nemotron import NemotronClient  # noqa: E402
from app.brain.text_utils import letters  # noqa: E402
from app.brain.tools.define import define_word  # noqa: E402
from app.brain.tools.store import InMemoryStore  # noqa: E402
from app.schemas.brain import BookContext, CapturedPage, PointedWord, TraceEvent  # noqa: E402
from app.schemas.page import Line, OcrLine  # noqa: E402

TEXT = [
    "Sir Bors was exhausted when he reached the",
    "castle at dusk. Above the gatehouse, the",
    "portcullis groaned upward on its rusted chains,",
    "and a sentry in a battered surcoat waved him",
    "through without a word.",
]
BOOK = BookContext(
    id=1,
    title="The Grey Knight (sample)",
    author="Team",
    genre="historical adventure",
    setting_era="medieval England",
    language="en-GB",
)
FLAT_W, FLAT_H, PHOTO_W, PHOTO_H = 1200, 900, 1200, 900
# Where the page's corners land in the photo: rotated and receding (top edge further away).
PHOTO_CORNERS = [(150, 150), (1080, 70), (1150, 820), (70, 860)]
FONTS = [
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/Library/Fonts/Georgia.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
]


# ------------------------------------------------------------------ rendering a page photo
def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [x - f * y for x, y in zip(m[r], m[c], strict=True)]
    return [m[i][n] / m[i][i] for i in range(n)]


def homography(src: list[tuple[float, float]], dst: list[tuple[float, float]]) -> list[float]:
    a, b = [], []
    for (x, y), (u, v) in zip(src, dst, strict=True):
        a += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]
        b += [u, v]
    return _solve(a, b)


def apply(h: list[float], x: float, y: float) -> tuple[float, float]:
    d = h[6] * x + h[7] * y + 1
    return ((h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d)


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


class Page:
    """A flat page, its tilted photo, and the OCR lines the phone would send for that photo."""

    def __init__(self, text: list[str]) -> None:
        self.text = text
        f = font(46)
        ascent, descent = f.getmetrics()
        self.line_h = ascent + descent
        flat = Image.new("RGB", (FLAT_W, FLAT_H), (250, 248, 242))
        draw = ImageDraw.Draw(flat)
        self.boxes: list[tuple[float, float, float, float, list]] = []  # x0,y0,x1,y1,words
        x0, y = 100, 150
        for line in text:
            draw.text((x0, y), line, font=f, fill=(30, 28, 26))
            words, pos = [], 0
            for token in line.split(" "):
                wx0 = x0 + f.getlength(line[:pos])
                words.append((token, wx0, wx0 + f.getlength(token)))
                pos += len(token) + 1
            self.boxes.append((x0, y, x0 + f.getlength(line), y + self.line_h, words))
            y += self.line_h + 30
        flat_corners = [(0, 0), (FLAT_W, 0), (FLAT_W, FLAT_H), (0, FLAT_H)]
        self.h = homography(flat_corners, PHOTO_CORNERS)  # flat -> photo
        inverse = homography(PHOTO_CORNERS, flat_corners)  # photo -> flat, for PIL
        self.photo = flat.transform(
            (PHOTO_W, PHOTO_H),
            Image.Transform.PERSPECTIVE,
            inverse,
            resample=Image.Resampling.BICUBIC,
            fillcolor=(74, 68, 60),
        )

    def norm(self, x: float, y: float) -> list[float]:
        u, v = apply(self.h, x, y)
        return [round(u / PHOTO_W, 5), round(v / PHOTO_H, 5)]

    def quad(self, x0: float, y0: float, x1: float, y1: float) -> list[list[float]]:
        return [self.norm(x0, y0), self.norm(x1, y0), self.norm(x1, y1), self.norm(x0, y1)]

    def ocr(self, replace: dict[str, str] | None = None) -> list[OcrLine]:
        """OCR lines with corner points; `replace` simulates OCR misreading a word."""
        replace = replace or {}
        out = []
        for i, (x0, y0, x1, y1, words) in enumerate(self.boxes):
            q = self.quad(x0, y0, x1, y1)
            xs, ys = [p[0] for p in q], [p[1] for p in q]
            out.append(
                OcrLine(
                    id=f"L{i + 1}",
                    text=" ".join(replace.get(token, token) for token, _, _ in words),
                    bbox=[min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)],
                    quad=q,
                    confidence=0.95,
                )
            )
        return out

    def tip_under(self, line: int, word: str) -> list[float]:
        """Where a fingertip just under `word` on a line (index from 0) is in the photo."""
        _, _, _, y1, words = self.boxes[line]
        _, wx0, wx1 = next(w for w in words if w[0] == word)
        return self.norm((wx0 + wx1) / 2, y1 + 0.35 * self.line_h)

    def jpeg_with_finger(self, tip: list[float]) -> bytes:
        """The photo with an index finger reaching up from below to the fingertip."""
        img = self.photo.copy()
        d = ImageDraw.Draw(img)
        tx, ty = tip[0] * PHOTO_W, tip[1] * PHOTO_H
        skin, nail = (214, 168, 138), (236, 204, 186)
        d.polygon(
            [(tx - 24, ty + 22), (tx + 24, ty + 22), (tx + 60, PHOTO_H), (tx - 55, PHOTO_H)],
            fill=skin,
        )
        d.ellipse([tx - 25, ty, tx + 25, ty + 60], fill=skin)
        d.ellipse([tx - 14, ty + 6, tx + 14, ty + 30], fill=nail)
        img = img.filter(ImageFilter.GaussianBlur(0.7))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue()


# ------------------------------------------------------------------ checks
RESULTS: list[dict] = []


def check(name: str, ok: bool, detail: str, seconds: float | None = None, group: str = "") -> None:
    RESULTS.append(
        {"group": group, "name": name, "ok": bool(ok), "detail": detail, "seconds": seconds}
    )
    t = f"{seconds:5.2f}s" if seconds is not None else "      "
    print(f"  {'PASS' if ok else 'FAIL'}  {t}  {name}: {detail}")


async def timed(coro):
    started = time.perf_counter()
    result = await coro
    return result, time.perf_counter() - started


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--save-images", type=Path)
    args = parser.parse_args()
    llm = get_llm()
    page = Page(TEXT)
    ocr = page.ocr()
    clean_photo = page.jpeg_with_finger(page.tip_under(2, "portcullis"))
    if args.save_images:
        args.save_images.mkdir(parents=True, exist_ok=True)
        (args.save_images / "page_photo.jpg").write_bytes(clean_photo)

    # 1. Model reachable
    reply, s = await timed(
        llm.chat([Message(role="user", content="Say OK.")], max_tokens=5, reasoning=False)
    )
    check("Nemotron reachable", bool(reply.text), f"{reply.provider}/{reply.model}", s, "Model")

    # 2. Page analysis with the photo
    page_analyzer._cache.clear()
    analysis, s = await timed(
        page_analyzer.analyze_page(page_id="p12", ocr_lines=ocr, image=clean_photo, book=BOOK)
    )
    hard = [hw.word for hw in analysis.hard_words]
    order_ok = analysis.reading_order == [f"L{i}" for i in range(1, 6)]
    rejoin = all(
        " ".join(c.text for c in analysis.chunks if c.line == ln.id) == ln.text
        for ln in analysis.lines
    )
    check(
        "Reading order from a tilted photo",
        order_ok,
        " ".join(analysis.reading_order),
        s,
        "Read a page",
    )
    check(
        "Phrases rejoin to each line",
        rejoin,
        f"{len(analysis.chunks)} phrases",
        None,
        "Read a page",
    )
    check(
        "Hard words flagged",
        len({"portcullis", "sentry", "surcoat"} & {letters(w) for w in hard}) >= 2,
        ", ".join(
            f"{hw.word} ({'-'.join(hw.syllables)}: {hw.meaning})" for hw in analysis.hard_words[:4]
        ),
        None,
        "Read a page",
    )
    check(
        "No false OCR disagreement",
        not analysis.ocr_disagreements,
        f"{len(analysis.ocr_disagreements)} flagged",
        None,
        "Read a page",
    )
    _, s = await timed(
        page_analyzer.analyze_page(page_id="p12", ocr_lines=ocr, image=clean_photo, book=BOOK)
    )
    check("Same photo again is served from cache", s < 0.05, f"{s * 1000:.0f} ms", s, "Read a page")

    bad_ocr = page.ocr(replace={"rusted": "busted"})
    page_analyzer._cache.clear()
    cross, s = await timed(
        page_analyzer.analyze_page(page_id="p12", ocr_lines=bad_ocr, image=clean_photo, book=BOOK)
    )
    flagged = [d.line for d in cross.ocr_disagreements]
    model_l3 = next((d.model_text for d in cross.ocr_disagreements if d.line == "L3"), "")
    check(
        "OCR misread caught by Nemotron",
        "L3" in flagged and "rusted" in model_l3,
        f"flagged {flagged or 'nothing'}; OCR said 'busted', Nemotron read '{model_l3}'",
        s,
        "Read a page",
    )

    # 3. The phone picks the pointed word (its job); the brain explains it.
    pointed = PointedWord(
        word="surcoat",
        line_id="L4",
        sentence=(
            "Above the gatehouse, the portcullis groaned upward on its rusted chains, and a "
            "sentry in a battered surcoat waved him through without a word."
        ),
    )

    # 4. Word meaning (Word Breakdown for a word not in the page cache)
    bd, s = await timed(define_word(pointed.word, pointed.sentence or "", BOOK))
    check(
        "Meaning in this book",
        bd.word == "surcoat" and bool(bd.meaning),
        f"{bd.word}: {'-'.join(bd.syllables)}, say {bd.say_as}, '{bd.meaning}'",
        s,
        "Explain a word",
    )

    # 5. Questions from speech-to-text
    captured = CapturedPage(
        page_id="p12",
        page_number="12",
        lines=[Line(id=ln.id, text=ln.text, bbox=ln.bbox) for ln in ocr],
    )
    store = InMemoryStore(books={1: BOOK}, pages={(1, 1): [captured]})
    events: list[TraceEvent] = []

    async def sink(e: TraceEvent) -> None:
        events.append(e)

    async def ask(q: str, **kw):
        return await timed(
            agent.ask(
                question=q,
                user_id=1,
                book_id=1,
                store=store,
                current_page=captured,
                on_event=sink,
                llm=llm,
                **kw,
            )
        )

    def cited(r) -> set[str]:
        return {f"{c.page_id}:{c.line_id}" for c in r.citations}

    r, s = await ask("what does port cullis mean")
    check(
        "Misheard 'port cullis'",
        r.grounded and "portcullis" in r.answer.lower() and "p12:L3" in cited(r),
        f"'{r.answer}' cites {sorted(cited(r))}",
        s,
        "Answer a question",
    )
    r2, s = await ask("why was the century there")
    check(
        "Misheard 'century' (sentry)",
        r2.grounded and "sentry" in r2.answer.lower() and "century" not in r2.answer.lower(),
        f"'{r2.answer}' cites {sorted(cited(r2))}",
        s,
        "Answer a question",
    )
    history = [
        Message(role="user", content="why was the sentry there"),
        Message(role="assistant", content=r2.answer),
    ]
    r, s = await ask("and what was he wearing", history=history)
    check(
        "Follow-up question",
        r.grounded and "surcoat" in r.answer.lower(),
        f"'{r.answer}'",
        s,
        "Answer a question",
    )
    r, s = await ask("what does this word mean", pointed=pointed)
    check(
        "'This word' while pointing",
        r.grounded and "surcoat" in r.answer.lower() and "p12:L4" in cited(r),
        f"'{r.answer}'",
        s,
        "Answer a question",
    )
    r, s = await ask("what is waiting for Sir Bors inside the castle")
    check(
        "No spoilers past the page",
        r.answer == agent.NOT_IN_PAGES
        or "don't" in r.answer.lower()
        or "doesn't" in r.answer.lower()
        or "not" in r.answer.lower(),
        f"'{r.answer}'",
        s,
        "Answer a question",
    )
    tools = sorted({e.name for e in events if e.kind == "tool_call"})
    check(
        "Trace screen gets each step",
        len(events) > 0,
        f"{len(events)} events; tools used: {', '.join(tools) or 'none'}; "
        f"heard_as fixes: {sum(e.name == 'heard_as' for e in events)}",
        None,
        "Answer a question",
    )

    # 6. Everyday mode
    bill = json.loads((ROOT / "samples" / "energy_bill.json").read_text())
    card, s = await timed(
        document_reasoner.read_document(ocr_lines=[OcrLine(**ln) for ln in bill["ocr_lines"]])
    )
    exp = bill["expected"]
    ok = card.deadline_iso == exp.get("deadline_iso") and (
        card.how_much.text if card.how_much else None
    ) == exp.get("amount_text")
    check("Bill: what, when, how much", ok, " / ".join(card.summary), s, "Read a bill")

    # 7. Model unreachable: nothing crashes, reading continues
    down = NemotronClient(base_url="http://127.0.0.1:9/v1", api_key="x", name="down")
    try:
        await page_analyzer.analyze_page(
            page_id="p13", ocr_lines=ocr, image=None, book=BOOK, llm=down
        )
        check("Page analysis, model down", False, "expected LLMError", None, "Model down")
    except LLMError:
        fb = page_analyzer.fallback_page("p13", ocr)
        check(
            "Page analysis, model down",
            fb.reading_order[:2] == ["L1", "L2"],
            "router serves fallback_page: order + phrases, no hard words",
            None,
            "Model down",
        )
    r = await agent.ask(
        question="what is a portcullis",
        user_id=1,
        book_id=1,
        store=store,
        current_page=captured,
        llm=down,
    )
    check(
        "Question, model down", r.answer == agent.UNAVAILABLE, f"'{r.answer}'", None, "Model down"
    )

    passed = sum(r["ok"] for r in RESULTS)
    print(f"\n{passed}/{len(RESULTS)} checks passed")
    out = ROOT / "results" / f"smoke-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(RESULTS, indent=2))
    print(f"Saved {out.relative_to(ROOT.parent)}")
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
