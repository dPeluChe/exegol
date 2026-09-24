import { describe, expect, it } from "vitest";
import { commandShape } from "./command-shape";

describe("commandShape", () => {
  it("keeps the binary and its flags, never prompts, paths or values", () => {
    expect(
      commandShape(
        "/opt/homebrew/bin/claude --settings /Users/x/.exegol/hooks/a.json --mcp-config /Users/x/m.json 'refactor billing'",
      ),
    ).toBe("claude --settings --mcp-config <args>");
  });

  it("marks nothing extra when there are only flags", () => {
    expect(commandShape("codex --yolo")).toBe("codex --yolo");
    expect(commandShape("claude")).toBe("claude");
  });
});
