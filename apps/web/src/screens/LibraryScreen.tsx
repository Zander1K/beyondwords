// Library: the user's books (metadata only, never book text).
// TODO(alex): build order step 3+. List books from the API; identify a book via /books/identify.
export function LibraryScreen() {
  return (
    <section>
      <h1>Library</h1>
      <p>Your books will appear here. Point the camera at a cover or title page to add one.</p>
    </section>
  );
}
