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
