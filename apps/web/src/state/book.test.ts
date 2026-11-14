import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type BookInfo, getApiContext } from "@/api";

import { useBooks } from "./book";

const book = (id: number, title = `Book ${id}`): BookInfo => ({
  id,
  isbn: null,
  title,
  author: null,
  publication_year: null,
  language: null,
  genre: null,
  setting_era: null,
  description_spoiler_free: null,
  metadata_source: null,
  last_read_at: null,
  finished: false,
});

const reply = (body: unknown, ok = true) =>
  vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    headers: new Headers(),
    json: async () => body,
  });

beforeEach(() => useBooks.getState().clear());
afterEach(() => vi.unstubAllGlobals());

describe("the reader's books", () => {
  it("loads them and opens the one the server lists first, telling the API", async () => {
    vi.stubGlobal("fetch", reply([book(3), book(1)]));
    await useBooks.getState().load(5);
    expect(useBooks.getState().current?.id).toBe(3);
    expect(getApiContext().bookId).toBe(3);
  });

  it("has no current book when they have none", async () => {
    vi.stubGlobal("fetch", reply([]));
    await useBooks.getState().load(5);
    expect(useBooks.getState().current).toBeNull();
    expect(getApiContext().bookId).toBeNull();
  });

  it("a newly added book becomes the open one, at the top", () => {
    useBooks.setState({ books: [book(1)], current: book(1) });
    useBooks.getState().added(book(2));
    expect(useBooks.getState().books.map((b) => b.id)).toEqual([2, 1]);
    expect(getApiContext().bookId).toBe(2);
  });

  it("opening a book works even if the server cannot be told", async () => {
    vi.stubGlobal("fetch", reply({}, false));
    useBooks.setState({ books: [book(1), book(2)], current: book(1) });
    await useBooks.getState().open(5, book(2));
    expect(useBooks.getState().current?.id).toBe(2);
    expect(getApiContext().bookId).toBe(2);
  });

  it("a failed load is an error state, not a crash", async () => {
    vi.stubGlobal("fetch", reply({}, false));
    await useBooks.getState().load(5);
    expect(useBooks.getState().status).toBe("error");
  });
});
