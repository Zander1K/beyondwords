// Access to the app: any username gets in, no password. A username is the whole account: a new
// one starts a new reader, a known one carries on where that reader left off. Nothing here is
// security (anyone can type anyone's name); it only tells readers apart.

/** Where a sign-in is kept: this browser (localStorage), so it survives closing the tab. */
export const SESSION_KEY = "beyondwords.session";

// Same rules as the API (apps/api/app/schemas/users.py), so a name that signs in here is one the
// server accepts: 3-32 characters of a-z, 0-9, "_", "." and "-", starting with a letter or number.
// Typed capitals are folded to lower case ("Ada" and "ada" are the same reader).
export const USERNAME_LIMITS = { min: 3, max: 32 } as const;

/** Tidy a typed username: control characters out, runs of spaces collapsed, ends trimmed. */
export function normaliseUsername(raw: string): string {
  // Whitespace (tabs and newlines from a paste included) becomes single spaces first; then any
  // other control character (\p{Cc}: NUL, escape, ...) is dropped.
  return raw
    .replace(/\s+/g, " ")
    .replace(/\p{Cc}/gu, "")
    .trim();
}

export type UsernameCheck = { ok: true; value: string } | { ok: false; message: string };

const ALLOWED = /^[a-z0-9][a-z0-9._-]*$/;

export function checkUsername(raw: string): UsernameCheck {
  const value = normaliseUsername(raw).toLowerCase();
  if (value.length < USERNAME_LIMITS.min) {
    return { ok: false, message: `Enter a username (at least ${USERNAME_LIMITS.min} characters).` };
  }
  if (value.length > USERNAME_LIMITS.max) {
    return { ok: false, message: `Keep it to ${USERNAME_LIMITS.max} characters or fewer.` };
  }
  if (!ALLOWED.test(value)) {
    return {
      ok: false,
      message: "Use letters and numbers, with dots, dashes or underscores. No spaces.",
    };
  }
  return { ok: true, value };
}

export interface Session {
  username: string;
  /** When they signed in (ms since 1970). */
  at: number;
  /** The reader's id on the server, once it knew them (POST /users/login). */
  userId?: number;
}

/** A stored session, or null if there is none or it is not one of ours. */
export function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return null;
    const { username, at, userId } = data as Record<string, unknown>;
    if (typeof username !== "string" || typeof at !== "number") return null;
    const check = checkUsername(username);
    if (!check.ok) return null;
    return typeof userId === "number"
      ? { username: check.value, at, userId }
      : { username: check.value, at };
  } catch {
    return null;
  }
}
