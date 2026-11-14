// Library: the reader's books (metadata only, never book text). Add one by photographing its
// barcode or cover (the reading model reads the ISBN, or the title if there is no ISBN), or by
// typing the ISBN. The book opened last is the one answers and definitions are fitted to.
import { type FormEvent, useState } from "react";

import { useAccess } from "@/access";
import {
  addBookByIsbn,
  ApiError,
  type BookInfo,
  preparePhoto,
  type ScanResult,
  scanBook,
} from "@/api";
import { useBooks } from "@/state";

import styles from "./LibraryScreen.module.css";

type Notice = { tone: "ok" | "error"; text: string };

function describe(book: BookInfo): string {
  return [book.author, book.publication_year].filter(Boolean).join(" · ");
}

export function LibraryScreen() {
  const userId = useAccess((s) => s.userId);
  const { books, current, status } = useBooks();
  const added = useBooks((s) => s.added);
  const open = useBooks((s) => s.open);
  const [busy, setBusy] = useState(false);
  const [isbn, setIsbn] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const finish = (book: BookInfo, how: string) => {
    added(book);
    setNotice({
      tone: "ok",
      text: `Added “${book.title}”${book.author ? ` by ${book.author}` : ""}${how}.`,
    });
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file || userId === null) return;
    setBusy(true);
    setNotice(null);
    try {
      const result: ScanResult = await scanBook(userId, await preparePhoto(file));
      finish(
        result,
        result.found_by === "title"
          ? " (no ISBN was readable, so I found it by its title)"
          : result.cached
            ? " (already in the library)"
            : "",
      );
    } catch (error) {
      setNotice({
        tone: "error",
        text:
          error instanceof ApiError
            ? error.message
            : "Couldn't read that photo. Check the connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const onIsbn = async (event: FormEvent) => {
    event.preventDefault();
    if (userId === null || !isbn.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      finish(await addBookByIsbn(userId, isbn.trim()), "");
      setIsbn("");
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof ApiError ? error.message : "Couldn't add that book just now.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.library}>
      <h1>Library</h1>

      {userId === null ? (
        <p role="status" className={styles.card}>
          Your library needs your profile from the server, which hasn't loaded yet. Make sure the
          server is running (<code>make local</code>): it keeps trying, so this should fix itself in
          a moment.
        </p>
      ) : (
        <div className={styles.card}>
          <h2>Add a book</h2>
          <p className={styles.note}>
            Photograph the barcode on the back, the copyright page, or the front cover. The title
            and author help your answers fit the book. Photos are read and not kept.
          </p>
          <label className={styles.photo} data-busy={busy}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={busy}
              onChange={(e) => {
                void onPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {busy ? "Reading the book…" : "📷 Take or choose a photo"}
          </label>
          <form onSubmit={(e) => void onIsbn(e)} className={styles.isbn}>
            <label>
              Or type the ISBN
              <input
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                inputMode="numeric"
                placeholder="978-0-14-143951-8"
                disabled={busy}
              />
            </label>
            <button type="submit" disabled={busy || !isbn.trim()}>
              Add
            </button>
          </form>
          {notice && (
            <p
              role={notice.tone === "error" ? "alert" : "status"}
              data-tone={notice.tone}
              className={styles.notice}
            >
              {notice.text}
            </p>
          )}
        </div>
      )}

      <h2 className={styles.heading}>Your books</h2>
      {status === "loading" && <p role="status">Loading your books…</p>}
      {status === "error" && <p role="alert">Couldn't load your books. Is the server running?</p>}
      {status === "ready" && books.length === 0 && (
        <p>No books yet. Add one above and your answers will fit it.</p>
      )}
      <ul className={styles.list}>
        {books.map((book) => (
          <li key={book.id} className={styles.book} data-current={current?.id === book.id}>
            <div>
              <h3>{book.title}</h3>
              <p className={styles.meta}>{describe(book)}</p>
              {book.setting_era && <p className={styles.chip}>Set in {book.setting_era}</p>}
              {book.description_spoiler_free && (
                <p className={styles.blurb}>{book.description_spoiler_free}</p>
              )}
            </div>
            {current?.id === book.id ? (
              <span className={styles.badge}>Reading now</span>
            ) : (
              <button type="button" onClick={() => userId !== null && void open(userId, book)}>
                Read this
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
