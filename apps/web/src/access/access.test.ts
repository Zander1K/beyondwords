import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ACCESS_PASSWORD_SHA256,
  checkPassword,
  checkUsername,
  normaliseUsername,
  parseSession,
  SESSION_KEY,
} from "./access";
import { sha256Hex } from "./sha256";
import { createAccessStore, type SessionStorageLike } from "./store";

const node = (s: string) => createHash("sha256").update(s).digest("hex");

describe("sha256Hex", () => {
  it("matches the standard test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("matches Node at every padding boundary and for non-ASCII text", () => {
    // 55 bytes fits one block with padding; 56 spills into a second; 63, 64 and beyond.
    for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const s = "x".repeat(n);
      expect(sha256Hex(s)).toBe(node(s));
    }
    for (const s of [
      TEST_PASSWORD,
      "Éire2026",
      "café ☕",
      "日本語",
      "😀 emoji",
      "tab\tand\nnewline",
    ]) {
      expect(sha256Hex(s)).toBe(node(s));
    }
  });
});

/** The tests use a password of their own: the real one is kept out of the repository. */
const TEST_PASSWORD = "correct horse battery";
const TEST_DIGEST = node(TEST_PASSWORD);

describe("checkPassword", () => {
  it("accepts the password, and only that", () => {
    expect(checkPassword(TEST_PASSWORD, TEST_DIGEST)).toBe(true);
    expect(checkPassword("Correct horse battery", TEST_DIGEST)).toBe(false);
    expect(checkPassword("correct horse batter", TEST_DIGEST)).toBe(false);
    expect(checkPassword("correct horse battery!", TEST_DIGEST)).toBe(false);
    expect(checkPassword("", TEST_DIGEST)).toBe(false);
    expect(checkPassword("correct  horse battery", TEST_DIGEST)).toBe(false);
  });

  it("ignores spaces typed around it (phone keyboards add them)", () => {
    expect(checkPassword("  correct horse battery ", TEST_DIGEST)).toBe(true);
  });

  it("is checked against the configured digest, which is a SHA-256 and not the password", () => {
    expect(ACCESS_PASSWORD_SHA256).toMatch(/^[0-9a-f]{64}$/);
    // The default is the configured digest: a wrong guess fails, whatever the test password is.
    expect(checkPassword(TEST_PASSWORD)).toBe(false);
    expect(checkPassword("")).toBe(false);
  });
});

describe("usernames", () => {
  it("tidies spaces and control characters", () => {
    expect(normaliseUsername("  Ada   Lovelace \n")).toBe("Ada Lovelace");
    expect(normaliseUsername("a\u0000b\u001fc")).toBe("abc");
  });

  it("accepts ordinary names in any language", () => {
    for (const name of [
      "ada",
      "Ada Lovelace",
      "Seán Ó Briain",
      "o'brien",
      "j.doe-2",
      "李明",
      "x7",
    ]) {
      expect(checkUsername(name)).toEqual({ ok: true, value: normaliseUsername(name) });
    }
  });

  it("asks for one when it is missing or too short, and says how long it can be", () => {
    for (const bad of ["", "   ", "a", " b "]) {
      const r = checkUsername(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/username/i);
    }
    const long = checkUsername("a".repeat(33));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.message).toMatch(/32/);
  });

  it("refuses markup and symbols", () => {
    for (const bad of ["<script>", "ada<b>", "a&b", "ada@home", "'quoted", "-dash", "ada;drop"]) {
      expect(checkUsername(bad).ok).toBe(false);
    }
  });
});

describe("parseSession", () => {
  it("reads back what was stored", () => {
    expect(parseSession(JSON.stringify({ username: "Ada", at: 5 }))).toEqual({
      username: "Ada",
      at: 5,
    });
  });

  it("returns null for anything that is not a session of ours", () => {
    for (const raw of [
      null,
      "",
      "not json",
      "42",
      "null",
      JSON.stringify({ username: "Ada" }),
      JSON.stringify({ username: 7, at: 1 }),
      JSON.stringify({ username: "<b>", at: 1 }),
      JSON.stringify({ username: "", at: 1 }),
    ]) {
      expect(parseSession(raw)).toBeNull();
    }
  });
});

describe("the access store", () => {
  /** A fake sessionStorage. */
  function fakeStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    const storage: SessionStorageLike = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
    return { storage, data };
  }

  it("starts signed out", () => {
    expect(createAccessStore(fakeStorage().storage, TEST_DIGEST).getState().user).toBeNull();
  });

  it("signs in with a username and the password, and remembers it for the tab", () => {
    const { storage, data } = fakeStorage();
    const store = createAccessStore(storage, TEST_DIGEST);
    const result = store.getState().signIn("  Ada  Lovelace ", TEST_PASSWORD);
    expect(result).toEqual({ ok: true, username: "Ada Lovelace" });
    expect(store.getState().user).toBe("Ada Lovelace");
    expect(JSON.parse(data.get(SESSION_KEY) ?? "{}")).toMatchObject({ username: "Ada Lovelace" });
    // A reload (a new store on the same storage) is still signed in.
    expect(createAccessStore(storage, TEST_DIGEST).getState().user).toBe("Ada Lovelace");
  });

  it("refuses a wrong password and stores nothing", () => {
    const { storage, data } = fakeStorage();
    const store = createAccessStore(storage, TEST_DIGEST);
    const result = store.getState().signIn("Ada", "letmein");
    expect(result).toMatchObject({ ok: false, field: "password" });
    expect(store.getState().user).toBeNull();
    expect(data.size).toBe(0);
  });

  it("refuses a missing username before it looks at the password", () => {
    const store = createAccessStore(fakeStorage().storage, TEST_DIGEST);
    expect(store.getState().signIn("", TEST_PASSWORD)).toMatchObject({
      ok: false,
      field: "username",
    });
    expect(store.getState().user).toBeNull();
  });

  it("signs out, forgetting the session", () => {
    const { storage, data } = fakeStorage();
    const store = createAccessStore(storage, TEST_DIGEST);
    store.getState().signIn("Ada", TEST_PASSWORD);
    store.getState().signOut();
    expect(store.getState().user).toBeNull();
    expect(data.size).toBe(0);
    expect(createAccessStore(storage, TEST_DIGEST).getState().user).toBeNull();
  });

  it("ignores a stored session that was tampered with", () => {
    const { storage } = fakeStorage({ [SESSION_KEY]: '{"username":"<img onerror=x>","at":1}' });
    expect(createAccessStore(storage, TEST_DIGEST).getState().user).toBeNull();
  });

  it("still works when storage is missing or refuses to write", () => {
    const none = createAccessStore(null, TEST_DIGEST);
    expect(none.getState().signIn("Ada", TEST_PASSWORD)).toMatchObject({ ok: true });
    expect(none.getState().user).toBe("Ada");
    const refusing = createAccessStore(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
      TEST_DIGEST,
    );
    expect(refusing.getState().signIn("Ada", TEST_PASSWORD)).toMatchObject({ ok: true });
    expect(() => refusing.getState().signOut()).not.toThrow();
    expect(refusing.getState().user).toBeNull();
  });
});
