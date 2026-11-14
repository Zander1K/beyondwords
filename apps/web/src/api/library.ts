// A reader's library and word bank (real calls to the API).
//   POST /users/{id}/books/scan      a photo of a book's barcode or cover -> the book, added
//   POST /users/{id}/books           a typed ISBN -> the book, added
//   GET  /users/{id}/books           their books, the current one first
//   PUT  /users/{id}/books/{b}/open  make a book the current one
//   POST /users/{id}/words           a word was looked up or asked about
//   GET  /users/{id}/words           their word bank
import { API_BASE_URL } from "@/config";

import { ApiError } from "./client";
import { getApiContext } from "./context";

/** Mirrors apps/api/app/schemas/books.py:UserBookResponse. */
export interface BookInfo {
  id: number;
  isbn: string | null;
  title: string;
  author: string | null;
  publication_year: number | null;
  language: string | null;
  genre: string | null;
  setting_era: string | null;
  description_spoiler_free: string | null;
  metadata_source: string | null;
  last_read_at: string | null;
  finished: boolean;
}

/** Mirrors apps/api/app/schemas/books.py:ScanBookResponse. */
export interface ScanResult extends BookInfo {
  cached: boolean;
  /** "title" when no ISBN could be read, so the printed title was searched. */
  found_by: "isbn" | "title";
  read: { isbn: string | null; title: string | null; author: string | null };
}

/** Mirrors apps/api/app/schemas/words.py:WordBankItem. */
export interface WordBankItem {
  id: number;
  word: string;
  times_rescued: number;
  status: string;
  last_seen: string;
  context_sentence: string | null;
  book_id: number | null;
  book_title: string | null;
  book_author: string | null;
}

/** Throws an ApiError whose message is the server's own explanation when it gave one. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
  });
  if (!response.ok) {
    let detail = `${init?.method ?? "GET"} ${path} failed with ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Not JSON: keep the generic message.
    }
    throw new ApiError(response.status, detail, response.headers.get("X-Request-ID"));
  }
  return (await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const listBooks = (userId: number) => request<BookInfo[]>(`/users/${userId}/books`);

export const addBookByIsbn = (userId: number, isbn: string) =>
  request<BookInfo>(`/users/${userId}/books`, json({ isbn }));

/** A photo of the book's barcode, copyright page or cover. */
export const scanBook = (userId: number, photo: Blob) =>
  request<ScanResult>(`/users/${userId}/books/scan`, {
    method: "POST",
    headers: { "Content-Type": photo.type || "image/jpeg" },
    body: photo,
  });

export const openBook = (userId: number, bookId: number) =>
  request<BookInfo>(`/users/${userId}/books/${bookId}/open`, { method: "PUT" });

export const listWords = (userId: number) => request<WordBankItem[]>(`/users/${userId}/words`);

/** The same lookup twice within this long is one lookup (a double trigger, a card re-render). */
const DUPLICATE_MS = 5000;
const lastRecorded = new Map<string, number>();

/**
 * A word was looked up (or asked about): add it to the reader's word bank, with the book they
 * have open and the line it was in. Fire and forget: the word bank never slows or breaks reading,
 * and nothing is recorded when nobody is signed in with a server profile.
 */
export function recordWord(
  word: string,
  sentence: string,
  source: "define" | "ask" = "define",
  now: number = Date.now(),
): void {
  const { userId, bookId } = getApiContext();
  if (userId === null) return;
  const key = `${userId}|${word.toLowerCase()}`;
  const last = lastRecorded.get(key);
  if (last !== undefined && now - last < DUPLICATE_MS) return;
  lastRecorded.set(key, now);
  void request(`/users/${userId}/words`, {
    ...json({ word, sentence, source, ...(bookId !== null ? { book_id: bookId } : {}) }),
  }).catch(() => undefined);
}

/** For tests. */
export function resetRecordedWords(): void {
  lastRecorded.clear();
}
