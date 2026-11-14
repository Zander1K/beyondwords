"""Brain evaluation (SOP section 11). Run with `make eval`.

    make eval                                 # samples + eval/pages, prints the SOP 11 table
    cd apps/api && uv run python ../../eval/run_eval.py --label after-prompt-v2 --only book

Each test page is a JSON file (format in eval/pages/README.md) with an optional photo of the
same name (.jpg/.jpeg/.png). Pages come from eval/samples/ (committed, original text, no
photos) and eval/pages/ (the real 20-page set, git-ignored).

Metrics (SOP 11):
- reading-order accuracy   longest common subsequence with the true order / true length
- hard-word recall         true hard words that were flagged / true hard words
- syllable accuracy        model syllables (before repair) that rejoin to the word and match
                           the hyphenation dictionary
- grounded answer rate     questions answered with a valid citation to a correct line
- ungrounded claims        sentences the grounding check had to remove
- everyday extraction      deadline, amount and action all correct
- latency                  median and max seconds per page analysis

Results are printed and saved to eval/results/<timestamp>-<label>.json (numbers only, no
page text), so baseline and after-fixes runs can be compared for the NVIDIA submission.
"""

import argparse
import asyncio
import json
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "apps" / "api"))

from app.brain import agent, document_reasoner, page_analyzer  # noqa: E402
from app.brain.llm import LLMError, get_llm  # noqa: E402
from app.brain.settings import get_brain_settings  # noqa: E402
from app.brain.structured import chat_json  # noqa: E402
from app.brain.text_utils import letters, syllables_agree  # noqa: E402
from app.brain.tools.store import InMemoryStore  # noqa: E402
from app.schemas.brain import BookContext, CapturedPage  # noqa: E402
from app.schemas.page import Line, OcrLine  # noqa: E402

PAGE_DIRS = [ROOT / "samples", ROOT / "pages"]
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png")


def _lcs(a: list[str], b: list[str]) -> int:
    prev = [0] * (len(b) + 1)
    for x in a:
        cur = [0]
        for j, y in enumerate(b):
            cur.append(prev[j] + 1 if x == y else max(prev[j + 1], cur[j]))
        prev = cur
    return prev[-1]


def _image_for(path: Path) -> bytes | None:
    for suffix in IMAGE_SUFFIXES:
        candidate = path.with_suffix(suffix)
        if candidate.exists():
            return candidate.read_bytes()
    return None


def _mean(values: list[float]) -> float | None:
    return round(statistics.mean(values), 3) if values else None


async def eval_book(spec: dict, image: bytes | None, llm) -> dict:
    ocr = [OcrLine(**line) for line in spec["ocr_lines"]]
    book = BookContext(**spec["book"]) if spec.get("book") else None
    settings = get_brain_settings()

    started = time.perf_counter()
    draft = await chat_json(
        llm,
        page_analyzer._build_messages(ocr, image, book, None),
        page_analyzer.PageDraft,
        max_tokens=6000,
        reasoning=settings.page_reasoning,
        timeout_s=settings.page_timeout_s,
    )
    seconds = time.perf_counter() - started
    analysis = page_analyzer.repair(spec["page_id"], draft, ocr, compare_text=image is not None)

    truth_order = spec["reading_order"]
    truth_words = {letters(w) for w in spec.get("hard_words", [])}
    flagged = {letters(hw.word) for hw in analysis.hard_words}
    syllable_ok = [syllables_agree(hw.syllables, hw.word) for hw in draft.hard_words]

    page = CapturedPage(
        page_id=spec["page_id"],
        page_number=spec.get("page_number"),
        lines=[Line(id=ln.id, text=ln.text, bbox=ln.bbox) for ln in ocr],
    )
    store = InMemoryStore(books={1: book} if book else {}, pages={(1, 1): [page]})
    grounded, removed = [], 0
    for q in spec.get("questions", []):
        result = await agent.ask(
            question=q["question"], user_id=1, book_id=1, store=store, current_page=page, llm=llm
        )
        cited = {f"{c.page_id}:{c.line_id}" for c in result.citations}
        grounded.append(result.grounded and bool(cited & set(q["answer_lines"])))
        removed += len(result.removed_sentences)

    return {
        "reading_order": _lcs([i for i in analysis.reading_order], truth_order) / len(truth_order),
        "hard_word_recall": len(flagged & truth_words) / len(truth_words) if truth_words else None,
        "syllable_accuracy": sum(syllable_ok) / len(syllable_ok) if syllable_ok else None,
        "grounded_answers": grounded,
        "ungrounded_claims": removed,
        "seconds": seconds,
        "ocr_disagreements": len(analysis.ocr_disagreements),
    }


async def eval_document(spec: dict, image: bytes | None, llm) -> dict:
    ocr = [OcrLine(**line) for line in spec["ocr_lines"]]
    expected = spec["expected"]
    started = time.perf_counter()
    card = await document_reasoner.read_document(ocr_lines=ocr, image=image, llm=llm)
    seconds = time.perf_counter() - started
    deadline_ok = card.deadline_iso == expected.get("deadline_iso")
    amount_ok = (card.how_much.text if card.how_much else None) == expected.get("amount_text")
    action_ok = any(k in card.what_to_do.lower() for k in expected.get("action_keywords", []))
    return {
        "everyday_correct": deadline_ok and amount_ok and action_ok,
        "deadline_ok": deadline_ok,
        "amount_ok": amount_ok,
        "action_ok": action_ok,
        "seconds": seconds,
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--label", default="run")
    parser.add_argument("--only", choices=["book", "document"])
    args = parser.parse_args()

    specs = sorted(p for d in PAGE_DIRS if d.exists() for p in d.glob("*.json"))
    if not specs:
        print("No test pages found in eval/samples or eval/pages.")
        return 1

    llm = get_llm()
    per_page: dict[str, dict] = {}
    for path in specs:
        spec = json.loads(path.read_text(encoding="utf-8"))
        if args.only and spec["kind"] != args.only:
            continue
        image = _image_for(path)
        name = f"{path.parent.name}/{path.stem}"
        try:
            if spec["kind"] == "book":
                per_page[name] = await eval_book(spec, image, llm)
            else:
                per_page[name] = await eval_document(spec, image, llm)
            print(f"  ok   {name} ({per_page[name]['seconds']:.1f}s)")
        except LLMError as exc:
            per_page[name] = {"error": str(exc)[:200]}
            print(f"  FAIL {name}: {str(exc)[:120]}")

    def collect(key: str) -> list:
        return [r[key] for r in per_page.values() if r.get(key) is not None]

    answers = [g for gs in collect("grounded_answers") for g in gs]
    seconds = collect("seconds")
    summary = {
        "reading_order_accuracy": _mean(collect("reading_order")),
        "hard_word_recall": _mean(collect("hard_word_recall")),
        "syllable_accuracy": _mean(collect("syllable_accuracy")),
        "grounded_answer_rate": _mean([float(a) for a in answers]),
        "ungrounded_claims": sum(collect("ungrounded_claims")),
        "everyday_extraction_accuracy": _mean([float(x) for x in collect("everyday_correct")]),
        "median_seconds": round(statistics.median(seconds), 2) if seconds else None,
        "max_seconds": round(max(seconds), 2) if seconds else None,
        "pages": len(per_page),
        "failed": sum("error" in r for r in per_page.values()),
    }

    print(f"\nBrain eval '{args.label}' over {summary['pages']} pages")
    for key, value in summary.items():
        print(f"  {key:30} {value}")

    out_dir = ROOT / "results"
    out_dir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = out_dir / f"{stamp}-{args.label}.json"
    out.write_text(
        json.dumps(
            {
                "label": args.label,
                "summary": summary,
                "pages": per_page,
                "prompt_versions": [
                    page_analyzer.PROMPT_VERSION,
                    agent.PROMPT_VERSION,
                    document_reasoner.PROMPT_VERSION,
                ],
            },
            indent=2,
            default=str,
        )
    )
    print(f"\nSaved {out.relative_to(ROOT.parent)}")
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
