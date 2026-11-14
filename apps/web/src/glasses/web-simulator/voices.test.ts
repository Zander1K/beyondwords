import { describe, expect, it } from "vitest";

import { buildLibrary, chooseVoice, isNovelty, type RawVoice, scoreVoice } from "./voices";

const v = (name: string, lang = "en-US", localService = true): RawVoice => ({
  voiceURI: `uri:${name}`,
  name,
  lang,
  localService,
});

describe("voice library", () => {
  it("ranks neural and premium voices above plain ones", () => {
    const lib = buildLibrary([
      v("Alex"),
      v("Microsoft Aria Online (Natural) - English (United States)", "en-US", false),
      v("Google US English", "en-US", false),
      v("Daniel (Enhanced)", "en-GB"),
      v("eSpeak English"),
    ]);
    expect(lib[0]?.name).toContain("Aria");
    expect(lib.map((x) => x.name).slice(-1)[0]).toBe("eSpeak English");
    expect(lib.find((x) => x.name.startsWith("Google"))?.natural).toBe(true);
    expect(lib.find((x) => x.name === "Alex")?.natural).toBe(false);
  });

  it("never offers novelty voices, even with a decoration on the name", () => {
    expect(isNovelty("Zarvox")).toBe(true);
    expect(isNovelty("Bubbles (English)")).toBe(true);
    expect(isNovelty("Samantha")).toBe(false);
    const names = buildLibrary([v("Zarvox"), v("Bad News"), v("Samantha")]).map((x) => x.name);
    expect(names).toEqual(["Samantha"]);
  });

  it("lists the reader's language first, then others, each best first", () => {
    const lib = buildLibrary(
      [
        v("Thomas", "fr-FR"),
        v("Samantha", "en-US"),
        v("Google français", "fr-FR", false),
        v("Karen", "en-AU"),
      ],
      "en-GB",
    );
    expect(lib.map((x) => x.lang.slice(0, 2))).toEqual(["en", "en", "fr", "fr"]);
    expect(lib[0]?.name).toBe("Karen"); // ties on score fall back to the name
  });

  it("lists a repeated voice once", () => {
    expect(buildLibrary([v("Samantha"), v("Samantha")])).toHaveLength(1);
  });

  it("scores a network voice a little above the same voice offline", () => {
    expect(scoreVoice(v("Foo", "en-US", false))).toBeGreaterThan(scoreVoice(v("Foo")));
  });

  it("chooses the saved voice if it is still there, else the best in their language", () => {
    const lib = buildLibrary([
      v("Samantha"),
      v("Google US English", "en-US", false),
      v("Thomas", "fr-FR"),
    ]);
    expect(chooseVoice(lib, "uri:Samantha")?.name).toBe("Samantha");
    expect(chooseVoice(lib, "uri:gone")?.name).toBe("Google US English");
    expect(chooseVoice(lib, null, "fr-FR")?.name).toBe("Thomas");
    expect(chooseVoice([], null)).toBeNull();
  });
});
