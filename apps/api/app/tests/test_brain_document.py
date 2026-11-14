from app.brain.document_reasoner import document_page, read_document
from app.brain.llm import LLMError
from app.brain.structured import extract_json
from app.brain.text_utils import split_phrases, syllabify
from app.schemas.page import OcrLine
from app.tests.brain_fakes import FakeLLM

BOX = [0.0, 0.0, 1.0, 0.05]
BILL = [
    OcrLine(id="L1", text="Northside Energy - Electricity bill", bbox=BOX),
    OcrLine(id="L2", text="Total to pay: €84.20", bbox=BOX),
    OcrLine(id="L3", text="Please pay by 28 November 2026", bbox=BOX),
]


def _draft(**overrides):
    draft = {
        "document_type": "electricity bill",
        "what_to_do": "Pay the electricity bill",
        "by_when": "28 November 2026",
        "deadline_iso": "2026-11-28",
        "how_much": {"value": 84.2, "currency": "EUR", "text": "€84.20"},
        "cites": ["L2", "L3", "L9"],
        "confidence": 0.9,
    }
    draft.update(overrides)
    return draft


async def test_bill_becomes_three_line_action_card() -> None:
    card = await read_document(ocr_lines=BILL, image=b"jpeg", llm=FakeLLM(_draft()))
    assert card.summary == ["Pay the electricity bill.", "By 28 November 2026.", "Amount: €84.20."]
    assert card.cites == ["L2", "L3"]  # unknown L9 dropped
    assert not card.needs_recapture
    assert document_page(card.doc_id).lines[1].text == "Total to pay: €84.20"


async def test_amount_not_on_the_page_is_never_read_out() -> None:
    draft = _draft(how_much={"value": 48.2, "currency": "EUR", "text": "€48.20"})
    card = await read_document(ocr_lines=BILL, llm=FakeLLM(draft))
    assert card.how_much is None
    assert card.needs_recapture
    assert card.summary[2] == "No amount to pay."


async def test_model_down_raises_llm_error() -> None:
    try:
        await read_document(ocr_lines=BILL, llm=FakeLLM(LLMError("down")))
    except LLMError:
        return
    raise AssertionError("expected LLMError")


def test_helpers() -> None:
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Sure! {"a": 2} hope that helps') == {"a": 2}
    assert "".join(syllabify("portcullis")) == "portcullis"
    text = "When the gate rose, the knight, tired and cold, rode slowly into the dark yard."
    assert " ".join(split_phrases(text)) == text
    assert all(len(p.split()) <= 5 for p in split_phrases(text))
