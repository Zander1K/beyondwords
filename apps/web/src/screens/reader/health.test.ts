import { describe, expect, it } from "vitest";

import { deriveIssues, derivePills, type ReaderHealth } from "./health";

const stream = {} as MediaStream;

const healthy: ReaderHealth = {
  camera: { kind: "on", stream },
  session: "started",
  asleep: false,
  offline: false,
  scan: { status: "live", lines: 12, ocrMs: 240, scans: 3 },
  tracking: { status: "running", fps: 19, detectMs: 8, fingerOnly: false },
  handLost: false,
};

const pill = (h: ReaderHealth, id: string) => derivePills(h).find((p) => p.id === id);

describe("derivePills", () => {
  it("shows everything working", () => {
    expect(derivePills(healthy).map((p) => [p.id, p.label, p.tone])).toEqual([
      ["camera", "Camera on", "ok"],
      ["glasses", "Reading", "ok"],
      ["page", "12 lines", "ok"],
      ["hands", "Hands", "ok"],
    ]);
    expect(pill(healthy, "hands")?.detail).toBe("19 fps · 8 ms");
  });

  it("has no page or hands pill for the camera it does not have", () => {
    const off = derivePills({ ...healthy, camera: { kind: "off" }, session: "stopped" });
    expect(off.map((p) => [p.id, p.tone])).toEqual([
      ["camera", "off"],
      ["glasses", "off"],
      ["page", "off"],
    ]);
    expect(off[2]?.label).toBe("Demo page");
  });

  it("marks what failed, in red, where it failed", () => {
    expect(
      pill({ ...healthy, camera: { kind: "error", code: "permission-denied" } }, "camera"),
    ).toMatchObject({
      tone: "error",
    });
    expect(pill({ ...healthy, scan: { status: "error", message: "x" } }, "page")).toMatchObject({
      label: "Reader failed",
      tone: "error",
    });
    expect(
      pill({ ...healthy, tracking: { ...healthy.tracking, status: "error" } }, "hands"),
    ).toMatchObject({
      label: "Hands unavailable",
      tone: "error",
    });
    expect(pill({ ...healthy, offline: true }, "glasses")).toMatchObject({ tone: "error" });
  });

  it("marks loading as busy and warnings as amber", () => {
    expect(pill({ ...healthy, scan: { status: "scanning" } }, "page")).toMatchObject({
      label: "Loading text reader",
      tone: "busy",
    });
    expect(
      pill({ ...healthy, tracking: { ...healthy.tracking, status: "loading" } }, "hands"),
    ).toMatchObject({
      tone: "busy",
    });
    expect(pill({ ...healthy, scan: { status: "empty", ocrMs: 90 } }, "page")).toMatchObject({
      tone: "warn",
    });
    expect(pill({ ...healthy, handLost: true }, "hands")).toMatchObject({ tone: "warn" });
    expect(pill({ ...healthy, asleep: true }, "glasses")).toMatchObject({ tone: "warn" });
  });

  it("calls a lone finger what it is", () => {
    const lone = { ...healthy, tracking: { ...healthy.tracking, fingerOnly: true } };
    expect(pill(lone, "hands")?.label).toBe("Finger only");
  });
});

describe("deriveIssues", () => {
  it("has none when everything works, and none for a lost hand (the pills say so)", () => {
    expect(deriveIssues(healthy)).toEqual([]);
    expect(deriveIssues({ ...healthy, handLost: true })).toEqual([]);
  });

  it("leaves a missing camera to the camera view", () => {
    expect(deriveIssues({ ...healthy, camera: { kind: "error", code: "no-device" } })).toEqual([]);
  });

  it("explains a text reader that did not load, and says it is retrying", () => {
    const [issue] = deriveIssues({ ...healthy, scan: { status: "error", message: "x" } });
    expect(issue).toMatchObject({ severity: "error", title: "Couldn't read the page", busy: true });
    expect(issue?.detail).toMatch(/connection/i);
  });

  it("offers to retry hand tracking, which does not retry on its own", () => {
    const issues = deriveIssues({ ...healthy, tracking: { ...healthy.tracking, status: "error" } });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.action).toEqual({ id: "retry-hands", label: "Try again" });
  });

  it("tells you to aim at the page when there is no text, and that the reader is loading", () => {
    expect(deriveIssues({ ...healthy, scan: { status: "empty", ocrMs: 80 } })[0]).toMatchObject({
      severity: "warn",
      title: "No text in view",
    });
    expect(deriveIssues({ ...healthy, scan: { status: "scanning" } })[0]).toMatchObject({
      severity: "info",
      busy: true,
    });
  });

  it("lists the worst first", () => {
    const issues = deriveIssues({
      ...healthy,
      scan: { status: "empty", ocrMs: 80 },
      tracking: { ...healthy.tracking, status: "error" },
    });
    expect(issues.map((i) => i.severity)).toEqual(["error", "warn"]);
  });
});
