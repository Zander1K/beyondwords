import { describe, expect, it } from "vitest";

import { EBOOK, EBOOK_PAGE_COUNT, ebookPage, wordsOf } from "./ebook";

describe("the embedded ebook", () => {
  it("has four pages of real reading", () => {
    expect(EBOOK_PAGE_COUNT).toBe(4);
    for (let i = 0; i < EBOOK_PAGE_COUNT; i++) {
      const lines = EBOOK.pages[i] ?? [];
      expect(lines.length).toBeGreaterThanOrEqual(10);
      const words = lines.join(" ").split(/\s+/).length;
      expect(words).toBeGreaterThan(60);
    }
  });

  it("builds each page as lines, phrases and words that line up with the text", () => {
    for (let i = 0; i < EBOOK_PAGE_COUNT; i++) {
      const page = ebookPage(i);
      expect(page.id).toBe(`ebook-${i + 1}`);
      expect(page.lines).toHaveLength(EBOOK.pages[i]?.length ?? -1);
      for (const l of page.lines) {
        // The phrases put back together are the line, so phrase offsets are right.
        expect(l.phrases.map((p) => p.text).join(" ")).toBe(l.text);
        for (const w of l.words ?? []) expect(l.text.slice(w.start, w.end)).toBe(w.text);
      }
    }
  });

  it("finds words with their offsets", () => {
    expect(wordsOf("Mira loved it.").map((w) => [w.text, w.start, w.end])).toEqual([
      ["Mira", 0, 4],
      ["loved", 5, 10],
      ["it.", 11, 14],
    ]);
  });

  it("clamps a page number that is out of range", () => {
    expect(ebookPage(-3).id).toBe("ebook-1");
    expect(ebookPage(99).id).toBe(`ebook-${EBOOK_PAGE_COUNT}`);
  });
});
