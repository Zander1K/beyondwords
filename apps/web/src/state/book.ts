// The reader's books and the one they have open (Zustand). The server keeps the list (the book
// opened last is first); the open book's id goes with every definition, question and picture
// request so answers fit the book (api/context.ts).
import { create } from "zustand";

import { type BookInfo, listBooks, openBook, setApiBook } from "@/api";

interface BookState {
  books: BookInfo[];
  /** The book the reader has open, or null if they have none yet. */
  current: BookInfo | null;
  status: "idle" | "loading" | "ready" | "error";
  /** Load the reader's books (on sign-in). Never throws. */
  load: (userId: number) => Promise<void>;
  /** A book was just added (scanned or typed): it becomes the open book. */
  added: (book: BookInfo) => void;
  /** Make a book the open one, and tell the server. */
  open: (userId: number, book: BookInfo) => Promise<void>;
  clear: () => void;
}

const pick = (books: BookInfo[]) => books[0] ?? null; // the server lists the last-opened first

export const useBooks = create<BookState>((set, get) => ({
  books: [],
  current: null,
  status: "idle",
  load: async (userId) => {
    set({ status: "loading" });
    try {
      const books = await listBooks(userId);
      const current = pick(books);
      setApiBook(current?.id ?? null);
      set({ books, current, status: "ready" });
    } catch {
      set({ status: "error" });
    }
  },
  added: (book) => {
    setApiBook(book.id);
    set((s) => ({ books: [book, ...s.books.filter((b) => b.id !== book.id)], current: book }));
  },
  open: async (userId, book) => {
    setApiBook(book.id);
    set((s) => ({ books: [book, ...s.books.filter((b) => b.id !== book.id)], current: book }));
    try {
      const saved = await openBook(userId, book.id);
      if (get().current?.id === book.id) set({ current: saved });
    } catch {
      // The choice still applies here; the server will hear about it the next time.
    }
  },
  clear: () => {
    setApiBook(null);
    set({ books: [], current: null, status: "idle" });
  },
}));
