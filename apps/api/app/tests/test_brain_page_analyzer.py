from app.brain import page_analyzer
from app.brain.page_analyzer import analyze_page, fallback_page
from app.schemas.page import OcrLine, PageAnalysis
from app.tests.brain_fakes import FakeLLM

LINES = [
    OcrLine(id="L1", text="The knight rode up to the castle.", bbox=[0.1, 0.10, 0.8, 0.04]),
    OcrLine(id="L2", text="The portcullis groaned upward.", bbox=[0.1, 0.15, 0.8, 0.04]),
    OcrLine(id="caption_1", text="Fig. 1", bbox=[0.1, 0.90, 0.2, 0.03]),
]


def _draft(**overrides):
    draft = {
        "reading_order": ["L1", "L2", "caption_1"],
        "lines": [
            {"id": "L1", "text": "The knight rode up to the castle."},
            {"id": "L2", "text": "The portcullis groaned upward."},
            {"id": "caption_1", "text": "Fig. 1"},
        ],
        "chunks": [
            {"line": "L1", "text": "The knight rode up"},
            {"line": "L1", "text": "to the castle."},
            {"line": "L2", "text": "The portcullis"},
            {"line": "L2", "text": "groaned upward."},
            {"line": "caption_1", "text": "Fig. 1"},
        ],
        "hard_words": [
            {
                "word": "portcullis",
                "line": "L2",
                "syllables": ["port", "cul", "lis"],
                "say_as": "port-CULL-iss",
                "meaning": "a heavy metal gate that slides down over a castle entrance",
                "illustratable": True,
                "confidence": 0.93,
            }
        ],
        "conversation_plan": {
            "questions": [{"type": "predict", "text": "What waits inside?", "cites": ["L2"]}],
            "revisit_word": "portcullis",
            "recap": {"text": "A knight arrives at a castle.", "cites": ["L1", "L2"]},
        },
    }
    draft.update(overrides)
    return draft


async def test_valid_draft_becomes_page_json() -> None:
    page_analyzer._cache.clear()
    llm = FakeLLM(_draft())
    result = await analyze_page(page_id="p12", ocr_lines=LINES, image=b"jpeg", llm=llm)

    assert isinstance(result, PageAnalysis)
    assert result.reading_order == ["L1", "L2", "caption_1"]
    assert [c.text for c in result.chunks][:2] == ["The knight rode up", "to the castle."]
    assert result.hard_words[0].syllables == ["port", "cul", "lis"]
    assert result.lines[1].bbox == [0.1, 0.15, 0.8, 0.04]  # boxes come from OCR
    assert result.ocr_disagreements == []
    # the photo was sent as an image part
    content = llm.calls[0]["messages"][1].content
    assert any(part.get("type") == "image_url" for part in content)


async def test_second_call_with_same_photo_uses_cache() -> None:
    page_analyzer._cache.clear()
    llm = FakeLLM(_draft())
    await analyze_page(page_id="p12", ocr_lines=LINES, image=b"jpeg", llm=llm)
    await analyze_page(page_id="p12", ocr_lines=LINES, image=b"jpeg", llm=llm)
    assert len(llm.calls) == 1


async def test_invalid_json_is_retried_once() -> None:
    page_analyzer._cache.clear()
    llm = FakeLLM("not json at all", _draft())
    result = await analyze_page(page_id="p12", ocr_lines=LINES, image=b"jpeg", llm=llm)
    assert len(llm.calls) == 2
    assert result.hard_words


async def test_bad_draft_is_repaired() -> None:
    page_analyzer._cache.clear()
    draft = _draft(
        reading_order=["L2", "L2", "ghost"],  # duplicate, unknown, missing L1/caption
        chunks=[{"line": "L1", "text": "The knight"}],  # does not rejoin to the line
        hard_words=[
            {
                "word": "portcullis",
                "line": "L2",
                "syllables": ["por", "cu"],
                "say_as": "x",
                "meaning": "gate",
                "illustratable": True,
                "confidence": 0.9,
            },
            {
                "word": "dragon",
                "line": "L2",
                "syllables": ["dra", "gon"],
                "say_as": "x",
                "meaning": "not on the line",
                "illustratable": True,
                "confidence": 0.9,
            },
            {
                "word": "knight",
                "line": "L1",
                "syllables": ["knight"],
                "say_as": "nite",
                "meaning": "unsure",
                "illustratable": True,
                "confidence": 0.2,
            },
        ],
        lines=[{"id": "L2", "text": "The portcullis growled upward loudly."}],
    )
    result = await analyze_page(page_id="p12", ocr_lines=LINES, image=b"jpeg", llm=FakeLLM(draft))
    assert result.reading_order == ["L2", "L1", "caption_1"]
    assert " ".join(c.text for c in result.chunks if c.line == "L1") == LINES[0].text
    assert [hw.word for hw in result.hard_words] == ["portcullis"]
    assert "".join(result.hard_words[0].syllables) == "portcullis"  # dictionary repair
    assert result.ocr_disagreements[0].line == "L2"


def test_fallback_needs_no_model() -> None:
    result = fallback_page("p1", LINES)
    assert result.reading_order == ["L1", "L2", "caption_1"]
    assert result.hard_words == []
    assert " ".join(c.text for c in result.chunks if c.line == "L2") == LINES[1].text
