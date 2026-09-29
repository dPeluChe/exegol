import { describe, expect, it } from "vitest";
import {
  expectReattach,
  settleAllReattach,
  settleReattach,
  whenSessionReady,
} from "./reattach-gate";

describe("reattach gate", () => {
  it("a pane waits for its own session, not the others", async () => {
    expectReattach(["a", "b"]);
    let aReady = false;
    let bReady = false;
    const a = whenSessionReady("a").then(() => {
      aReady = true;
    });
    const b = whenSessionReady("b").then(() => {
      bReady = true;
    });
    settleReattach("a");
    await a;
    expect(aReady).toBe(true);
    expect(bReady).toBe(false);
    settleAllReattach();
    await b;
    expect(bReady).toBe(true);
  });

  it("a session not being reattached answers at once", async () => {
    await expect(whenSessionReady("new-agent", 50)).resolves.toBeUndefined();
  });
});
