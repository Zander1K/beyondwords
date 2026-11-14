// What to tell the reader after they scan a book from the camera. Pure, so the wording is tested.
import { ApiError, type ScanResult } from "@/api";

export const SCAN_NEEDS_CAMERA = "Turn the camera on, then hold the book's barcode up to scan it.";
export const SCAN_NEEDS_PROFILE =
  "Your profile hasn't loaded yet, so the book can't be added. Check the server is running.";
export const SCANNING = "Reading the book… hold the barcode steady.";
const SCAN_FAILED =
  "Couldn't read that. Hold the barcode close and steady, in good light, then try again.";

/** "Added “Title” by Author." plus how it was found, when that is worth saying. */
export function scanSuccessText(book: ScanResult): string {
  const base = `Added “${book.title}”${book.author ? ` by ${book.author}` : ""}.`;
  if (book.found_by === "title") return `${base} No ISBN was readable, so I found it by its title.`;
  if (book.cached) return `${base} It was already in the library.`;
  return base;
}

/** The server's own explanation when it gave one ("I couldn't read a book…"), else a hint. */
export function scanFailureText(error: unknown): string {
  return error instanceof ApiError ? error.message : SCAN_FAILED;
}
