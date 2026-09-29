import { describe, expect, it } from "vitest";
import { markRecoveryDone, setLostOnRestart, takeLostOnRestart } from "./lost-sessions";

describe("lost sessions after a restart", () => {
  it("waits for recovery, then hands the ids out once", async () => {
    const pending = takeLostOnRestart();
    setLostOnRestart(["a", "b"]);
    markRecoveryDone();
    expect(await pending).toEqual(["a", "b"]);
    expect(await takeLostOnRestart()).toEqual([]);
  });
});
