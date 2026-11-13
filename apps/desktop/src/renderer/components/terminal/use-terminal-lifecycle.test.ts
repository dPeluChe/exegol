import { describe, expect, it } from "vitest";
import { showsEnded } from "./use-terminal-lifecycle";

describe("showsEnded", () => {
  it("a live session is never shown as ended", () => {
    expect(showsEnded(false, true, false)).toBe(false);
  });

  it("an ended one waits only while its history loads and nothing was seen", () => {
    expect(showsEnded(true, false, true)).toBe(false);
    expect(showsEnded(true, true, true)).toBe(true);
    expect(showsEnded(true, false, false)).toBe(true);
  });
});
