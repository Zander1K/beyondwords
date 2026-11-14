import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { Profile } from "@/api";

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

  it("accepts names the API accepts, folding capitals to lower case", () => {
    for (const [typed, stored] of [
      ["ada", "ada"],
      ["Ada_L", "ada_l"],
      ["  J.Doe-2 ", "j.doe-2"],
      ["x77", "x77"],
    ] as const) {
      expect(checkUsername(typed)).toEqual({ ok: true, value: stored });
    }
  });

  it("asks for one when it is missing or too short, and says how long it can be", () => {
    for (const bad of ["", "   ", "a", "ab", " b "]) {
      const r = checkUsername(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/username/i);
    }
    const long = checkUsername("a".repeat(33));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.message).toMatch(/32/);
  });

  it("refuses what the API refuses: spaces, markup, symbols, other alphabets", () => {
    for (const bad of [
      "ada lovelace",
      "<script>",
      "ada<b>",
      "a&b",
      "ada@home",
      "_lead",
      "-dash",
      "ada;drop",
      "李明明",
      "seán",
    ]) {
      expect(checkUsername(bad).ok).toBe(false);
    }
  });
});

describe("parseSession", () => {
  it("reads back what was stored", () => {
    expect(parseSession(JSON.stringify({ username: "Ada", at: 5 }))).toEqual({
      username: "ada",
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
    const result = store.getState().signIn("  Ada_Lovelace ", TEST_PASSWORD);
    expect(result).toEqual({ ok: true, username: "ada_lovelace" });
    expect(store.getState().user).toBe("ada_lovelace");
    expect(JSON.parse(data.get(SESSION_KEY) ?? "{}")).toMatchObject({ username: "ada_lovelace" });
    // A reload (a new store on the same storage) is still signed in.
    expect(createAccessStore(storage, TEST_DIGEST).getState().user).toBe("ada_lovelace");
  });

  it("refuses a wrong password and stores nothing", () => {
    const { storage, data } = fakeStorage();
    const store = createAccessStore(storage, TEST_DIGEST);
    const result = store.getState().signIn("ada", "letmein");
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
    store.getState().signIn("ada", TEST_PASSWORD);
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
    expect(none.getState().signIn("ada", TEST_PASSWORD)).toMatchObject({ ok: true });
    expect(none.getState().user).toBe("ada");
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
    expect(refusing.getState().signIn("ada", TEST_PASSWORD)).toMatchObject({ ok: true });
    expect(() => refusing.getState().signOut()).not.toThrow();
    expect(refusing.getState().user).toBeNull();
  });

  const profile = (over: Partial<Profile> = {}): Profile => ({
    id: 42,
    username: "ada_l",
    display_name: null,
    support_level: "read_along",
    glasses_type: null,
    voice: null,
    spacing: null,
    onboarded: false,
    ...over,
  });

  it("tells the server who signed in and keeps the profile it answers with", async () => {
    const { storage, data } = fakeStorage();
    const register = vi.fn().mockResolvedValue(profile());
    const store = createAccessStore(storage, TEST_DIGEST, register);
    store.getState().signIn("Ada_L", TEST_PASSWORD);
    expect(register).toHaveBeenCalledWith("ada_l");
    expect(store.getState().profile).toBeNull(); // not known until the server answers
    await vi.waitFor(() => expect(store.getState().userId).toBe(42));
    expect(store.getState().profile?.onboarded).toBe(false);
    expect(JSON.parse(data.get(SESSION_KEY) ?? "{}")).toMatchObject({ userId: 42 });
    expect(createAccessStore(storage, TEST_DIGEST).getState().userId).toBe(42);
  });

  it("asks the server for the profile again after a reload", async () => {
    const { storage } = fakeStorage();
    const first = createAccessStore(storage, TEST_DIGEST, vi.fn().mockResolvedValue(profile()));
    first.getState().signIn("ada_l", TEST_PASSWORD);
    await vi.waitFor(() => expect(first.getState().profile).not.toBeNull());
    const register = vi.fn().mockResolvedValue(profile({ onboarded: true }));
    const reloaded = createAccessStore(storage, TEST_DIGEST, register);
    expect(register).toHaveBeenCalledWith("ada_l");
    await vi.waitFor(() => expect(reloaded.getState().profile?.onboarded).toBe(true));
  });

  it("remembers a skipped setup for this session only", () => {
    const store = createAccessStore(fakeStorage().storage, TEST_DIGEST);
    store.getState().signIn("ada", TEST_PASSWORD);
    store.getState().skipOnboarding();
    expect(store.getState().onboardingSkipped).toBe(true);
    store.getState().signOut();
    expect(store.getState().onboardingSkipped).toBe(false);
  });

  it("stays signed in when the server cannot be reached", async () => {
    const register = vi.fn().mockRejectedValue(new Error("offline"));
    const store = createAccessStore(fakeStorage().storage, TEST_DIGEST, register);
    expect(store.getState().signIn("ada", TEST_PASSWORD)).toMatchObject({ ok: true });
    await Promise.resolve();
    expect(store.getState().user).toBe("ada");
    expect(store.getState().profile).toBeNull();
  });

  it("ignores a late answer after signing out", async () => {
    let answer: (p: Profile) => void = () => undefined;
    const register = vi.fn().mockReturnValue(new Promise<Profile>((r) => (answer = r)));
    const store = createAccessStore(fakeStorage().storage, TEST_DIGEST, register);
    store.getState().signIn("ada", TEST_PASSWORD);
    store.getState().signOut();
    answer(profile({ id: 7 }));
    await Promise.resolve();
    expect(store.getState().userId).toBeNull();
    expect(store.getState().profile).toBeNull();
  });
});
