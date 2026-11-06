import { describe, expect, it } from "vitest";
import { freshLoad, shouldStopLoad } from "./load-state";

describe("how long a load may hold the page scripts", () => {
  const now = 1_000_000;
  const load = freshLoad(now - 11_000);

  it("stops a page whose DOM is there: only a resource is pending", () => {
    expect(shouldStopLoad({ ...load, domReady: true }, now)).toBe(true);
  });

  it("never stops a document the server has not answered: it may be compiling", () => {
    expect(shouldStopLoad(load, now)).toBe(false);
  });

  it("gives a blocking resource in the head longer before stopping", () => {
    expect(shouldStopLoad({ ...load, committedAt: now - 11_000 }, now)).toBe(false);
    expect(shouldStopLoad({ ...load, committedAt: now - 26_000 }, now)).toBe(true);
  });
});
