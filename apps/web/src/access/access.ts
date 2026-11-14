// Access to the app: a username and a shared password, checked in the browser.
//
// HONEST NOTE: this is a courtesy gate for a demo, not security. Everything here runs in the
// visitor's browser, so anyone who opens the developer tools can read the check, and the digest
// below can be guessed offline. Keeping the digest rather than the password only stops the
// password sitting in plain text in the repository. If the app ever has to be truly protected,
// the check must move to the server (FastAPI) and the API must refuse unauthenticated calls.
import { sha256Hex } from "./sha256";

/**
 * SHA-256 of the access password (not the password itself; see the note above). To change the
 * password: `printf '%s' 'the new password' | shasum -a 256`, and paste the hex here.
 */
export const ACCESS_PASSWORD_SHA256 =
  "cc71aa7fdf277df21c9ed1e8e74164fa95edde471cb51aebca157737602acaf1";

/** Where a sign-in is kept: this tab only, gone when it closes. */
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

/** Equal strings, taking the same time wherever they first differ. */
function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Whether `input` is the access password. Spaces around it are ignored (phone keyboards add
 * them). `digest` is only for tests, which use a password of their own.
 */
export function checkPassword(input: string, digest: string = ACCESS_PASSWORD_SHA256): boolean {
  return sameDigest(sha256Hex(input.trim()), digest);
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
