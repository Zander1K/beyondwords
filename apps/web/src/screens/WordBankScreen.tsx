// Word Bank: the words the reader looked up or asked about while reading, with the book and the
// line where they met each one. Filled automatically as they read.
import { useEffect, useState } from "react";

import { useAccess } from "@/access";
import { listWords, type WordBankItem } from "@/api";

import styles from "./WordBankScreen.module.css";

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; words: WordBankItem[] };

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function WordBankScreen() {
  const userId = useAccess((s) => s.userId);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (userId === null) return;
    let current = true;
    listWords(userId)
      .then((words) => current && setLoad({ state: "ready", words }))
      .catch(() => current && setLoad({ state: "error" }));
    return () => {
      current = false;
    };
  }, [userId, attempt]);

  return (
    <section className={styles.bank}>
      <h1>Word Bank</h1>
      {userId === null ? (
        <p role="status">
          Your word bank needs your profile from the server, which hasn't loaded yet. Make sure the
          server is running (<code>make local</code>): it keeps trying, so this should fix itself in
          a moment.
        </p>
      ) : load.state === "loading" ? (
        <p role="status">Loading your words…</p>
      ) : load.state === "error" ? (
        <p role="alert">
          Couldn't load your words.{" "}
          <button
            type="button"
            onClick={() => {
              setLoad({ state: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </p>
      ) : load.words.length === 0 ? (
        <p>
          Words you look up or ask about while reading are saved here, with the book and the line
          where you met them.
        </p>
      ) : (
        <>
          <p className={styles.count}>
            {load.words.length} {load.words.length === 1 ? "word" : "words"}, newest first.
          </p>
          <ul className={styles.list}>
            {load.words.map((w) => (
              <li key={w.id} className={styles.word}>
                <div className={styles.head}>
                  <strong>{w.word}</strong>
                  {w.times_rescued > 1 && (
                    <span className={styles.times}>looked up {w.times_rescued}×</span>
                  )}
                  <span className={styles.when}>{when(w.last_seen)}</span>
                </div>
                {w.book_title && <p className={styles.from}>in {w.book_title}</p>}
                {w.context_sentence && <p className={styles.sentence}>“{w.context_sentence}”</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
