"""Small deterministic text helpers used by the page analyst, tools and grounding."""

import re
from difflib import SequenceMatcher
from functools import lru_cache

import pyphen

_WORD = re.compile(r"[A-Za-z][A-Za-z'’-]*")
_PAUSE = re.compile(r"(?<=[,;:.!?])\s+")
_SPACES = re.compile(r"\s+")


def normalise(text: str) -> str:
    """Lowercase, straight quotes, single spaces. For comparisons only, never for display."""
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return _SPACES.sub(" ", text).strip().lower()


def letters(text: str) -> str:
    return re.sub(r"[^a-z]", "", text.lower())


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalise(a), normalise(b)).ratio()


@lru_cache(maxsize=8)
def _dictionary(lang: str) -> pyphen.Pyphen:
    return pyphen.Pyphen(lang=lang if lang in pyphen.LANGUAGES else "en_GB", left=2, right=2)


def _breaks(word: str, lang: str) -> set[int]:
    return set(_dictionary(lang).positions(word))


def dictionary_breaks(word: str, lang: str = "en_GB") -> set[int]:
    """Character offsets where hyphenation dictionaries allow a break.

    For English, the British and US dictionaries are combined: each alone under-splits
    (en_GB gives "battered", en_US gives "portcullis" unsplit).
    """
    breaks = _breaks(word, lang)
    if lang.startswith("en"):
        breaks |= _breaks(word, "en_US") | _breaks(word, "en_GB")
    return breaks


def syllabify(word: str, lang: str = "en_GB") -> list[str]:
    """Rule-based syllable split from hyphenation dictionaries (SOP 8.2 `syllabify`).

    Hyphenation points are a close proxy for spoken syllables, not identical: dictionaries
    never split off a single letter, so "about" stays whole. Used as the check on the model
    and as the offline fallback.
    """
    clean = word.strip(".,;:!?\"'()[]")
    if not clean:
        return []
    cuts = [0, *sorted(dictionary_breaks(clean, lang)), len(clean)]
    return [clean[a:b].lower() for a, b in zip(cuts, cuts[1:], strict=False) if b > a]


def syllables_agree(syllables: list[str], word: str, lang: str = "en_GB") -> bool:
    """SOP 11 syllable accuracy: the split rejoins to the word and breaks everywhere the
    dictionary does (it may break more finely, as speech does)."""
    if not syllables_match_word(syllables, word):
        return False
    model_breaks, pos = set(), 0
    for part in syllables[:-1]:
        pos += len(part)
        model_breaks.add(pos)
    return dictionary_breaks(word.strip(".,;:!?\"'()[]"), lang) <= model_breaks


def syllables_match_word(syllables: list[str], word: str) -> bool:
    return bool(syllables) and letters("".join(syllables)) == letters(word)


def word_in_text(word: str, text: str) -> bool:
    target = letters(word)
    return any(letters(w) == target for w in _WORD.findall(text))


def split_phrases(text: str, max_words: int = 5) -> list[str]:
    """Fallback phrase splitter: break at punctuation, then into runs of <= max_words.

    The pieces joined with single spaces reproduce `text` (with whitespace collapsed).
    """
    pieces: list[str] = []
    for clause in _PAUSE.split(_SPACES.sub(" ", text).strip()):
        words = clause.split(" ")
        if not clause:
            continue
        n = max(1, -(-len(words) // max_words))  # number of groups, sizes as even as possible
        size = -(-len(words) // n)
        pieces.extend(" ".join(words[i : i + size]) for i in range(0, len(words), size))
    return pieces


def sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z\"“(])", text.strip())
    return [p.strip() for p in parts if p.strip()]


_ROMAN = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}


def _roman_value(label: str) -> int | None:
    if not label or any(ch not in _ROMAN for ch in label):
        return None
    total = 0
    for ch, nxt in zip(label, label[1:] + " ", strict=True):
        value = _ROMAN[ch]
        total += -value if nxt in _ROMAN and _ROMAN[nxt] > value else value
    return total if total > 0 else None


def page_order(label: str | int | None) -> tuple[int, int] | None:
    """Sort key for a printed page label: roman front matter ("xiv") before arabic ("3").

    Returns None for labels it cannot place (e.g. "Plate 3"); callers must then keep the page,
    never drop it, since it was captured by the reader.
    """
    if label is None:
        return None
    text = str(label).strip().lower()
    if text.isdigit():
        return (1, int(text))
    roman = _roman_value(text)
    return (0, roman) if roman is not None else None


# Words that carry the question, not its subject; never matched against the page.
_QUESTION_WORDS = {
    "what",
    "whats",
    "does",
    "doesnt",
    "mean",
    "means",
    "meaning",
    "why",
    "who",
    "whos",
    "where",
    "when",
    "how",
    "which",
    "this",
    "that",
    "these",
    "those",
    "word",
    "words",
    "here",
    "there",
    "they",
    "them",
    "their",
    "with",
    "about",
    "the",
    "and",
    "did",
    "doing",
    "said",
    "say",
    "says",
    "page",
    "line",
    "book",
    "explain",
    "tell",
    "please",
    "could",
    "would",
    "should",
    "can",
    "you",
    "is",
    "are",
    "was",
    "were",
    "it",
    "its",
    "of",
    "to",
    "a",
    "an",
    "in",
    "on",
    "he",
    "she",
    "his",
    "her",
    "him",
    "me",
    "my",
    "i",
    "do",
    "again",
    "happened",
    "happen",
    "happening",
    "going",
}


def heard_as_page_words(
    question: str, page_texts: list[str], threshold: float = 0.75
) -> list[dict[str, str]]:
    """Speech-to-text often mishears the unusual words readers ask about ("port cullis" for
    portcullis). Match runs of the question's content words, alone or joined, to page words
    that are spelled almost the same. Returns [{"heard": ..., "page_word": ...}], best first.
    """
    vocab: dict[str, str] = {}
    for text in page_texts:
        for m in _WORD.finditer(text):
            key = letters(m.group())
            if len(key) >= 4:
                vocab.setdefault(key, m.group().strip("'’-"))
    tokens = [m.group() for m in _WORD.finditer(question)]
    runs: list[list[str]] = [[]]
    for token in tokens:
        if letters(token) in _QUESTION_WORDS:
            runs.append([])
        else:
            runs[-1].append(token)
    phrases = {
        " ".join(run[i:j])
        for run in runs
        for i in range(len(run))
        for j in range(i + 1, min(i + 4, len(run) + 1))
    }
    best: dict[str, tuple[float, str]] = {}
    for phrase in phrases:
        key = letters(phrase)
        if len(key) < 5:
            continue
        if key in vocab:
            if " " in phrase:  # heard as separate words: "port cullis"
                best[vocab[key]] = (1.0, phrase)
            continue  # a single word already spelled as on the page needs no hint
        for page_key, page_word in vocab.items():
            if abs(len(page_key) - len(key)) > max(2, len(page_key) // 3):
                continue
            matcher = SequenceMatcher(None, key, page_key)
            if matcher.quick_ratio() < threshold:
                continue
            ratio = matcher.ratio()
            if ratio >= threshold and ratio > best.get(page_word, (0.0, ""))[0]:
                best[page_word] = (ratio, phrase)
    ranked = sorted(best.items(), key=lambda kv: -kv[1][0])[:3]
    return [{"heard": phrase, "page_word": word} for word, (_, phrase) in ranked]


def correct_to_page_words(question: str, page_texts: list[str]) -> tuple[str, list[dict[str, str]]]:
    """The question with misheard page words replaced by the page's spelling, and the fixes.

    "why was the century there" on a page with "sentry" -> "why was the sentry there".
    """
    fixes = heard_as_page_words(question, page_texts)
    fixed = question
    for fix in fixes:
        pattern = r"\b" + r"\s+".join(re.escape(w) for w in fix["heard"].split()) + r"\b"
        fixed = re.sub(pattern, fix["page_word"], fixed, count=1, flags=re.IGNORECASE)
    return fixed, fixes


_WORD_CHARS = re.compile(r"[^\W_]+")


def word_differences(ocr_text: str, model_text: str) -> list[tuple[str, str]]:
    """Words that differ between two readings of a line, as (ocr, model) pairs; case and
    punctuation are ignored."""
    a, b = _WORD_CHARS.findall(ocr_text.lower()), _WORD_CHARS.findall(model_text.lower())
    matcher = SequenceMatcher(None, a, b, autojunk=False)
    return [
        (" ".join(a[i1:i2]), " ".join(b[j1:j2]))
        for tag, i1, i2, j1, j2 in matcher.get_opcodes()
        if tag != "equal"
    ]
