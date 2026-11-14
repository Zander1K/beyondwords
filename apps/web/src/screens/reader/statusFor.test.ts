import { describe, expect, it } from "vitest";

import { statusFor } from "./useReaderController";

describe("statusFor with a spoken question", () => {
  const idle = { status: "idle" } as const;

  it("shows listening and thinking above everything else", () => {
    expect(statusFor(idle, true, "no-word", "listening")).toBe("listening");
    expect(statusFor({ status: "error", message: "x" }, false, null, "thinking")).toBe("thinking");
  });

  it("changes nothing when no question is being asked", () => {
    expect(statusFor(idle, true, null, null)).toBe("hand-lost");
    expect(statusFor(idle, false, "no-word")).toBe("no-word");
    expect(statusFor(idle)).toBeNull();
  });
});
