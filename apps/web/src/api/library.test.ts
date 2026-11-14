import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./client";
import { setApiBook, setApiUser, withBook } from "./context";
import { addBookByIsbn, recordWord, resetRecordedWords, scanBook } from "./library";

const ok = (body: unknown) =>
  vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => body });
const fail = (status: number, detail: string) =>
  vi.fn().mockResolvedValue({
    ok: false,
    status,
    headers: new Headers(),
    json: async () => ({ detail }),
  });

beforeEach(() => {
  resetRecordedWords();
  setApiUser(null);
  setApiBook(null);
});
afterEach(() => vi.unstubAllGlobals());

describe("the library client", () => {
  it("sends the photo as the raw body and the typed ISBN as JSON", async () => {
    const f = ok({ id: 1, title: "T" });
    vi.stubGlobal("fetch", f);
    const photo = new Blob(["jpeg"], { type: "image/jpeg" });
    await scanBook(7, photo);
    expect(f.mock.calls[0]?.[0]).toBe("/api/users/7/books/scan");
    expect(f.mock.calls[0]?.[1].body).toBe(photo);
    await addBookByIsbn(7, "9780141439518");
    expect(JSON.parse(f.mock.calls[1]?.[1].body)).toEqual({ isbn: "9780141439518" });
  });

  it("surfaces the server's own explanation when a scan fails", async () => {
    vi.stubGlobal("fetch", fail(422, "I couldn't read a book in that photo."));
    const error = await scanBook(7, new Blob(["x"])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("I couldn't read a book in that photo.");
    expect((error as ApiError).status).toBe(422);
  });
});

describe("recording words", () => {
  it("records nothing when nobody is signed in with a server profile", () => {
    const f = ok({});
    vi.stubGlobal("fetch", f);
    recordWord("lantern", "A lantern glowed.");
    expect(f).not.toHaveBeenCalled();
  });

  it("sends the word, its line and the open book", () => {
    const f = ok({});
    vi.stubGlobal("fetch", f);
    setApiUser(5);
    setApiBook(9);
    recordWord("lantern", "A lantern glowed.", "ask");
    expect(f.mock.calls[0]?.[0]).toBe("/api/users/5/words");
    expect(JSON.parse(f.mock.calls[0]?.[1].body)).toEqual({
      word: "lantern",
      sentence: "A lantern glowed.",
      source: "ask",
      book_id: 9,
    });
  });

  it("counts the same word twice in a moment as one lookup", () => {
    const f = ok({});
    vi.stubGlobal("fetch", f);
    setApiUser(5);
    recordWord("Lantern", "s", "define", 1000);
    recordWord("lantern", "s", "define", 2000);
    expect(f).toHaveBeenCalledTimes(1);
    recordWord("lantern", "s", "define", 7000); // later: a real second lookup
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("never throws when the server is down", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    setApiUser(5);
    expect(() => recordWord("lantern", "s")).not.toThrow();
  });
});

describe("the open book rides along with requests", () => {
  it("is added when the request names none, and never overrides one", () => {
    type Body = { q: number; book_id?: number | null };
    const send = (body: Body) => withBook(body);
    expect(send({ q: 1 })).toEqual({ q: 1 }); // no book open
    setApiBook(4);
    expect(send({ q: 1 })).toEqual({ q: 1, book_id: 4 });
    expect(send({ q: 1, book_id: 8 })).toEqual({ q: 1, book_id: 8 });
    expect(send({ q: 1, book_id: null })).toEqual({ q: 1, book_id: null });
  });
});
