import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isExegolHook } from "./wrappers";

describe("isExegolHook", () => {
  const notify = join(homedir(), ".exegol", "hooks", "notify.sh");

  it("matches only the notify script, not a user hook whose path says exegol", () => {
    const ours = {
      hooks: [{ type: "command", command: `[ -x "${notify}" ] && "${notify}" stop` }],
    };
    const user = {
      hooks: [{ type: "command", command: "/Users/me/code/labs-exegol/scripts/lint.sh" }],
    };
    expect(isExegolHook(ours)).toBe(true);
    expect(isExegolHook(user)).toBe(false);
  });
});
