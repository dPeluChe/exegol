import { describe, expect, it } from "vitest";
import { hookCwdOf, noteHookCwd } from "./hook-cwd";

describe("hook cwd", () => {
  it("keeps the last absolute folder an agent reported", () => {
    noteHookCwd("h1", "/p");
    noteHookCwd("h1", "/p/nexus-control");
    expect(hookCwdOf("h1")).toBe("/p/nexus-control");
  });

  it("ignores empty or relative folders", () => {
    noteHookCwd("h2", "/p");
    noteHookCwd("h2", "");
    noteHookCwd("h2", "nexus");
    noteHookCwd("h2", undefined);
    expect(hookCwdOf("h2")).toBe("/p");
    expect(hookCwdOf("unknown")).toBeNull();
  });
});
