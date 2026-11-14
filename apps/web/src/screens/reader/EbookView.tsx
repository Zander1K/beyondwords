// The ebook reading view: a streamlined way to use the reader without a camera. The mouse cursor
// is the fingertip: hovering a word highlights its phrase and the word (and the glasses display
// shows the phrase); clicking a word opens its card (pronunciation, definition, picture);
// clicking it again, or Esc, closes the card. The same keys as the camera mode work (arrows move
// by phrase and line, Enter selects) because they come through the glasses simulator.
//
// While a card is open, hovering does NOT move the card (that would look up every word the mouse
// passes over); clicking another word does.
import { useEffect, useMemo } from "react";

import { EBOOK, EBOOK_PAGE_COUNT, ebookPage } from "@/ebook/ebook";
import { type GlassesGesture, useNoteActivity } from "@/glasses";
import { isLoading } from "@/api";
import { phraseAtOffset, phraseStart } from "@/reader";
import { useReaderStore } from "@/state";

import styles from "./EbookView.module.css";

interface Props {
  /** 0-based page number. */
  pageNo: number;
  onPage: (pageNo: number) => void;
  /** Apply a reader action with the usual feedback (cues, read-aloud). */
  onGesture: (gesture: GlassesGesture) => void;
}

export function EbookView({ pageNo, onPage, onGesture }: Props) {
  const noteActivity = useNoteActivity();
  const page = useMemo(() => ebookPage(pageNo), [pageNo]);
  const position = useReaderStore((s) => s.reader.position);
  const view = useReaderStore((s) => s.reader.view);
  const card = useReaderStore((s) => s.reader.card);

  // The reader works on this page; turning the page starts at its top.
  useEffect(() => {
    useReaderStore.getState().setPage(page);
  }, [page]);

  const phraseOf = (line: number, word: number) => {
    const w = page.lines[line]?.words?.[word];
    return w ? phraseAtOffset(page, line, w.start) : 0;
  };

  const hover = (line: number, word: number) => {
    noteActivity(); // the mouse is input: keep the display awake
    const s = useReaderStore.getState();
    if (s.reader.view === "card") return; // do not look up every word the mouse passes
    const p = s.reader.position;
    if (p.line === line && p.word === word) return;
    s.setPosition({ line, phrase: phraseOf(line, word), word });
  };

  const choose = (line: number, word: number) => {
    noteActivity();
    const s = useReaderStore.getState();
    const at = s.reader.position;
    if (s.reader.view === "card" && at.line === line && at.word === word) {
      onGesture("back"); // clicking the open word again closes it
      return;
    }
    s.setPosition({ line, phrase: phraseOf(line, word), word });
    // With a card already open the card follows the new word; otherwise open one.
    if (useReaderStore.getState().reader.view !== "card") onGesture("select");
  };

  const last = EBOOK_PAGE_COUNT - 1;

  return (
    <section
      className={styles.ebook}
      aria-label={`${EBOOK.title}, page ${pageNo + 1} of ${EBOOK_PAGE_COUNT}`}
    >
      <nav className={styles.pager} aria-label="Pages">
        <button
          type="button"
          onClick={() => {
            noteActivity();
            onPage(pageNo - 1);
          }}
          disabled={pageNo === 0}
        >
          ‹ Previous
        </button>
        <span aria-live="polite">
          Page {pageNo + 1} of {EBOOK_PAGE_COUNT}
        </span>
        <button
          type="button"
          onClick={() => {
            noteActivity();
            onPage(pageNo + 1);
          }}
          disabled={pageNo === last}
        >
          Next ›
        </button>
      </nav>

      {view === "card" && card && (
        // The card on the glasses display is not clickable (it is the glasses' screen), and Enter
        // on a focused word re-clicks the word, so reading the card aloud has its own button.
        <button
          type="button"
          className={styles.hear}
          onClick={() => onGesture("select")}
          disabled={isLoading(card) || Boolean(card.problem)}
        >
          🔊 Hear “{card.word}”
        </button>
      )}

      <article className={styles.page}>
        {pageNo === 0 && (
          <header className={styles.head}>
            <h2 className={styles.title}>{EBOOK.title}</h2>
            <p className={styles.byline}>{EBOOK.byline}</p>
            <p className={styles.chapter}>{EBOOK.chapter}</p>
          </header>
        )}
        <div className={styles.text}>
          {page.lines.map((l, i) => {
            const onThisLine = position.line === i;
            const pStart = onThisLine ? phraseStart(page, i, position.phrase) : 0;
            const pEnd = onThisLine ? pStart + (l.phrases[position.phrase]?.text.length ?? 0) : 0;
            return (
              <p key={`${page.id}-${i}`} className={styles.line} data-current={onThisLine}>
                {(l.words ?? []).map((w, j) => {
                  const inPhrase = onThisLine && w.start >= pStart && w.end <= pEnd;
                  const pointed = onThisLine && position.word === j;
                  return (
                    <span key={j} className={styles.slot} data-phrase={inPhrase}>
                      <button
                        type="button"
                        className={styles.word}
                        data-pointed={pointed}
                        data-open={pointed && view === "card"}
                        onPointerEnter={() => hover(i, j)}
                        onClick={() => choose(i, j)}
                      >
                        {w.text}
                      </button>{" "}
                    </span>
                  );
                })}
              </p>
            );
          })}
        </div>
        {pageNo === last && <p className={styles.end}>The end</p>}
      </article>
    </section>
  );
}
