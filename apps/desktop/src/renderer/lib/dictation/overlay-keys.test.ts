import { describe, expect, it } from "vitest";
import { overlayKeyAction } from "./overlay-keys";
import { insertHint, targetLabel } from "./target";

const key = (k: string, extra: Partial<Parameters<typeof overlayKeyAction>[0]> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});

describe("overlayKeyAction", () => {
  it("Enter inserts while recording, and never reaches the pane while transcribing", () => {
    expect(overlayKeyAction(key("Enter"), "listening")).toBe("insert");
    expect(overlayKeyAction(key("Enter"), "starting")).toBe("insert");
    expect(overlayKeyAction(key("Enter"), "transcribing")).toBe("swallow");
  });

  it("leaves keys alone with the overlay closed or on a panel with buttons", () => {
    expect(overlayKeyAction(key("Enter"), "idle")).toBeNull();
    expect(overlayKeyAction(key("Escape"), "idle")).toBeNull();
    expect(overlayKeyAction(key("Enter"), "no-model")).toBeNull();
    expect(overlayKeyAction(key("Enter"), "error")).toBeNull();
  });

  it("Esc cancels in every open phase", () => {
    expect(overlayKeyAction(key("Escape"), "listening")).toBe("cancel");
    expect(overlayKeyAction(key("Escape"), "no-model")).toBe("cancel");
  });

  it("never takes an IME composition's Enter or Esc", () => {
    expect(overlayKeyAction(key("Enter", { isComposing: true }), "listening")).toBeNull();
    expect(overlayKeyAction(key("Enter", { keyCode: 229 }), "listening")).toBeNull();
    expect(overlayKeyAction(key("Escape", { isComposing: true }), "listening")).toBeNull();
  });

  it("leaves Enter with a modifier and other keys to the pane", () => {
    expect(overlayKeyAction(key("Enter", { shiftKey: true }), "listening")).toBeNull();
    expect(overlayKeyAction(key("Enter", { metaKey: true }), "listening")).toBeNull();
    expect(overlayKeyAction(key("a"), "listening")).toBeNull();
  });
});

describe("insert hint", () => {
  const terminal = { kind: "terminal", paneId: "p", projectId: "x", agentId: "a" } as const;

  it("names the agent by alias and CLI, a shell as shell", () => {
    expect(targetLabel(terminal, { alias: "lupus", cliType: "claude-code" })).toBe(
      "lupus · claude-code",
    );
    expect(targetLabel(terminal, { cliType: "codex" })).toBe("codex");
    expect(targetLabel(terminal, { cliType: "shell" })).toBe("shell");
    expect(targetLabel({ kind: "browser", paneId: "p", projectId: "x" })).toBe("");
  });

  it("says whether Enter is sent", () => {
    expect(insertHint("terminal", "shell", false)).toBe("Inserts into shell (no Enter sent)");
    expect(insertHint("terminal", "shell", true)).toBe("Inserts into shell (then presses Enter)");
    expect(insertHint("browser", "", false)).toBe("Inserts into the browser field");
    expect(insertHint("clipboard", "", false)).toBe("Copies to the clipboard");
  });
});
