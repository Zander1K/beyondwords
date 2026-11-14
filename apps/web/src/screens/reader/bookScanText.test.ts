import { describe, expect, it } from "vitest";

import { ApiError, type ScanResult } from "@/api";

import { scanFailureText, scanSuccessText } from "./bookScanText";

const book = (over: Partial<ScanResult> = {}): ScanResult => ({
  id: 1,
  isbn: "9780141439518",
  title: "Pride and Prejudice",
  author: "Jane Austen",
  publication_year: 1813,
  language: "en",
  genre: null,
  setting_era: null,
  description_spoiler_free: null,
  metadata_source: "google_books",
  last_read_at: null,
  finished: false,
  cached: false,
  found_by: "isbn",
  read: { isbn: "9780141439518", title: null, author: null },
  ...over,
});

describe("book scan wording", () => {
  it("says what was added, and how it was found when that is notable", () => {
    expect(scanSuccessText(book())).toBe("Added “Pride and Prejudice” by Jane Austen.");
    expect(scanSuccessText(book({ author: null }))).toBe("Added “Pride and Prejudice”.");
    expect(scanSuccessText(book({ cached: true }))).toContain("already in the library");
    expect(scanSuccessText(book({ found_by: "title" }))).toContain("found it by its title");
  });

  it("uses the server's explanation for a failure, else a hint for the barcode", () => {
    expect(scanFailureText(new ApiError(422, "I couldn't read a book in that photo.", null))).toBe(
      "I couldn't read a book in that photo.",
    );
    expect(scanFailureText(new Error("network"))).toMatch(/barcode close and steady/);
  });
});
