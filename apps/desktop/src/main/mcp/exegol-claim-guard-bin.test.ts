import { describe, expect, it } from "vitest";
import { targetPath } from "./exegol-claim-guard-bin";

/**
 * The hook payload is an external contract owned by Claude Code, and this
 * parser is the whole of the guard's understanding of it. A silent change here
 * does not throw — it means enforcement quietly stops working, which is the one
 * failure a security-shaped feature must not have.
 */
describe("targetPath", () => {
  it("reads the path each write-shaped tool actually sends", () => {
    expect(targetPath({ tool_name: "Edit", tool_input: { file_path: "/repo/a.ts" } })).toBe(
      "/repo/a.ts",
    );
    expect(targetPath({ tool_name: "Write", tool_input: { file_path: "/repo/b.ts" } })).toBe(
      "/repo/b.ts",
    );
    expect(
      targetPath({ tool_name: "NotebookEdit", tool_input: { notebook_path: "/repo/n.ipynb" } }),
    ).toBe("/repo/n.ipynb");
  });

  it("resolves a relative path against the working directory", () => {
    const out = targetPath({ tool_input: { file_path: "src/a.ts" } });
    expect(out?.startsWith("/")).toBe(true);
    expect(out?.endsWith("/src/a.ts")).toBe(true);
  });

  it("returns null for calls that touch no file, so they are never blocked", () => {
    expect(targetPath({ tool_name: "Bash", tool_input: { command: "ls" } })).toBeNull();
    expect(targetPath({ tool_input: {} })).toBeNull();
    expect(targetPath(null)).toBeNull();
    expect(targetPath({ tool_input: { file_path: "" } })).toBeNull();
  });
});
