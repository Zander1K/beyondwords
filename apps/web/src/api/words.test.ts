import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchIllustration, fetchWordCard, isLoading, willIllustrate, wordCardNow } from "./words";

const reply = (body: unknown, ok = true) =>
  vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    headers: new Headers(),
    json: async () => body,
  });

afterEach(() => vi.unstubAllGlobals());

describe("word cards", () => {
  it("opens with a placeholder, then the API's meaning", async () => {
    expect(isLoading(wordCardNow("portcullis", "The portcullis rose."))).toBe(true);
    vi.stubGlobal(
      "fetch",
      reply({ word: "portcullis", meaning: "A heavy gate.", degraded: false, syllables: [] }),
    );
    const card = await fetchWordCard("portcullis,", "The portcullis rose.");
    expect(card).toEqual({ word: "portcullis", short: "A heavy gate." });
    // Cached: the next open shows it at once, with no second call.
    expect(wordCardNow("portcullis,", "The portcullis rose.").short).toBe("A heavy gate.");
  });

  it("says the lookup did not load when the API is down or degraded", async () => {
    vi.stubGlobal("fetch", reply({}, false));
    expect((await fetchWordCard("aloof", "He was aloof.")).problem).toBe("load-failed");
    vi.stubGlobal("fetch", reply({ word: "aloof", meaning: "", degraded: true, syllables: [] }));
    expect((await fetchWordCard("aloof", "He was aloof.")).problem).toBe("load-failed");
  });

  it("does not call the API for a stray mark", () => {
    expect(wordCardNow("—", "x").problem).toBe("not-found");
  });
});

describe("word card pronunciation", () => {
  it("uses the brain's respelling, else the syllables", async () => {
    vi.stubGlobal(
      "fetch",
      reply({
        word: "aloof",
        meaning: "Distant.",
        say_as: "uh-LOOF",
        syllables: ["a", "loof"],
        degraded: false,
      }),
    );
    expect((await fetchWordCard("aloof", "He was aloof one")).pronunciation).toBe("uh-LOOF");
    vi.stubGlobal(
      "fetch",
      reply({
        word: "tower",
        meaning: "Tall.",
        say_as: "",
        syllables: ["tow", "er"],
        degraded: false,
      }),
    );
    expect((await fetchWordCard("tower", "A tower stood")).pronunciation).toBe("tow·er");
  });
});

describe("word card illustration", () => {
  const define = (illustratable: boolean) => ({
    word: "lantern",
    meaning: "A light in a case.",
    say_as: "LAN-tern",
    syllables: [],
    degraded: false,
    illustratable,
  });

  it("draws a pictureable word and keeps the picture on the card", async () => {
    vi.stubGlobal("fetch", reply(define(true)));
    expect((await fetchWordCard("lantern,", "A lantern glowed.")).illustratable).toBe(true);
    const fetchMock = reply({ id: "abc", url: "/illustrations/abc" });
    vi.stubGlobal("fetch", fetchMock);
    const url = await fetchIllustration("lantern,", "A lantern glowed.");
    expect(url).toBe("/api/illustrations/abc");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({ text: "lantern" });
    // Reopening the card (even with the comma) shows the picture at once.
    expect(wordCardNow("lantern", "A lantern glowed.").imageUrl).toBe("/api/illustrations/abc");
  });

  it("does not draw a word the brain says cannot be pictured", async () => {
    vi.stubGlobal("fetch", reply({ ...define(false), word: "although" }));
    await fetchWordCard("although", "Although it rained.");
    const fetchMock = reply({ id: "x", url: "/illustrations/x" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchIllustration("although", "Although it rained.")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the card without a picture when the picture service fails", async () => {
    vi.stubGlobal("fetch", reply({ ...define(true), word: "kettle" }));
    await fetchWordCard("kettle", "The kettle sang.");
    vi.stubGlobal("fetch", reply({}, false));
    expect(await fetchIllustration("kettle", "The kettle sang.")).toBeNull();
  });
});

describe("declined illustrations", () => {
  it("does not ask again for a word the picture service declined, but retries other failures", async () => {
    vi.stubGlobal(
      "fetch",
      reply({
        word: "promise",
        meaning: "A vow.",
        say_as: "PROM-iss",
        syllables: [],
        degraded: false,
        illustratable: true,
      }),
    );
    await fetchWordCard("promise", "A promise was made.");
    const refuse = reply({ detail: "better explained than pictured" }, false);
    refuse.mockResolvedValue({
      ok: false,
      status: 422,
      headers: new Headers(),
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", refuse);
    expect(await fetchIllustration("promise", "A promise was made.")).toBeNull();
    expect(await fetchIllustration("promise", "A promise was made.")).toBeNull();
    expect(refuse).toHaveBeenCalledTimes(1); // the second time it did not even ask
  });

  it("tries again after a temporary failure", async () => {
    vi.stubGlobal(
      "fetch",
      reply({
        word: "anchor",
        meaning: "Heavy hook.",
        say_as: "ANG-ker",
        syllables: [],
        degraded: false,
        illustratable: true,
      }),
    );
    await fetchWordCard("anchor", "The anchor dropped.");
    const down = reply({}, false); // 503
    vi.stubGlobal("fetch", down);
    expect(await fetchIllustration("anchor", "The anchor dropped.")).toBeNull();
    expect(await fetchIllustration("anchor", "The anchor dropped.")).toBeNull();
    expect(down).toHaveBeenCalledTimes(2);
  });
});

describe("word card picture loading", () => {
  it("shows a card opened while its picture is being drawn as loading", async () => {
    vi.stubGlobal(
      "fetch",
      reply({
        word: "kettle",
        meaning: "A pot.",
        say_as: "KET-ul",
        syllables: [],
        degraded: false,
        illustratable: true,
      }),
    );
    await fetchWordCard("kettle", "The kettle sang.");
    expect(willIllustrate("kettle", "The kettle sang.")).toBe(true);
    let finish: (v: unknown) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((r) => (finish = r))));
    const drawing = fetchIllustration("kettle", "The kettle sang.");
    expect(wordCardNow("kettle", "The kettle sang.")).toMatchObject({ imageLoading: true });
    finish({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ id: "k", url: "/illustrations/k" }),
    });
    await drawing;
    const after = wordCardNow("kettle", "The kettle sang.");
    expect(after.imageUrl).toBe("/api/illustrations/k");
    expect(after).not.toHaveProperty("imageLoading");
    expect(willIllustrate("kettle", "The kettle sang.")).toBe(false);
  });

  it("does not say it will draw a word that cannot be pictured", async () => {
    vi.stubGlobal(
      "fetch",
      reply({
        word: "although",
        meaning: "Even if.",
        say_as: "all-THOH",
        syllables: [],
        degraded: false,
        illustratable: false,
      }),
    );
    await fetchWordCard("although", "Although it rained.");
    expect(willIllustrate("although", "Although it rained.")).toBe(false);
  });
});
