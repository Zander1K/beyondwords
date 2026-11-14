// Who is reading and which book they have open, for API calls made from anywhere in the app
// (definitions, questions, pictures, the word bank). Set by the access store (the reader) and the
// book store (the current book); read when a request is made. Module state, not React state, so
// non-component code (the reader store, the speech flow) can use it without importing the stores.

let current: { userId: number | null; bookId: number | null } = { userId: null, bookId: null };

export function setApiUser(userId: number | null): void {
  current = { userId, bookId: userId === null ? null : current.bookId };
}

export function setApiBook(bookId: number | null): void {
  current = { ...current, bookId };
}

export function getApiContext(): { userId: number | null; bookId: number | null } {
  return current;
}

/** Add the open book to a request body that does not name one: answers then fit the book. */
export function withBook<T extends { book_id?: number | null }>(body: T): T {
  return body.book_id === undefined && current.bookId !== null
    ? { ...body, book_id: current.bookId }
    : body;
}
