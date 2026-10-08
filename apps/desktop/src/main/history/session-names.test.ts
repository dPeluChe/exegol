import { describe, expect, it } from "vitest";
import { cliSessionNames, repeatsTask } from "./index";

describe("repeatsTask", () => {
  it("drops a title that is the task or starts with it", () => {
    expect(repeatsTask("Fix the  build", "fix the build")).toBe(true);
    expect(repeatsTask("fix the build and the tests", "fix the build")).toBe(true);
    expect(repeatsTask("X equal Dev", "fix the build")).toBe(false);
    expect(repeatsTask("anything", "")).toBe(false);
  });
});

describe("cliSessionNames", () => {
  it("returns nothing without refs and for a CLI with no adapter", async () => {
    expect(await cliSessionNames([])).toEqual({});
    expect(
      await cliSessionNames([
        { agentId: "a", provider: "amp", sessionId: "T-1", cwd: "/repo", task: "" },
      ]),
    ).toEqual({});
  });
});
