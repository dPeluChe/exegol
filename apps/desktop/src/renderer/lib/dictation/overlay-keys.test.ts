import { describe, expect, it } from "vitest";
import { OVERLAY_ATTR, otherDialogOpen, overlayKeyAction } from "./overlay-keys";
import { insertHint, targetName } from "./target";

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

  it("Enter is the focused pane's once the focus left the dictation's target; Esc still cancels", () => {
    const away = { onTarget: false };
    expect(overlayKeyAction(key("Enter"), "listening", away)).toBeNull();
    expect(overlayKeyAction(key("Enter"), "transcribing", away)).toBeNull();
    expect(overlayKeyAction(key("Escape"), "listening", away)).toBe("cancel");
  });

  it("an open dialog takes Esc first; the next Esc cancels the dictation", () => {
    expect(overlayKeyAction(key("Escape"), "listening", { dialogOpen: true })).toBeNull();
    expect(overlayKeyAction(key("Escape"), "listening", { dialogOpen: false })).toBe("cancel");
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

describe("otherDialogOpen", () => {
  const el = (
    role: string,
    opts: { state?: string; inOverlay?: boolean; shown?: boolean } = {},
  ) => ({
    getAttribute: (name: string) =>
      name === "role" ? role : name === "data-state" ? (opts.state ?? null) : null,
    closest: (sel: string) => (opts.inOverlay && sel === `[${OVERLAY_ATTR}]` ? {} : null),
    getClientRects: () => ({ length: opts.shown === false ? 0 : 1 }),
  });
  const root = (els: ReturnType<typeof el>[]) =>
    ({ querySelectorAll: () => els }) as unknown as ParentNode;

  it("Monaco's find widget (role=dialog, no open state, mounted after one Cmd+F) never blocks Esc", () => {
    expect(otherDialogOpen(root([el("dialog")]))).toBe(false);
    expect(otherDialogOpen(root([el("dialog", { state: "closed" })]))).toBe(false);
  });

  it("ignores the overlay itself and a dialog that is not on screen", () => {
    expect(otherDialogOpen(root([el("dialog", { state: "open", inOverlay: true })]))).toBe(false);
    expect(otherDialogOpen(root([el("dialog", { state: "open", shown: false })]))).toBe(false);
    expect(otherDialogOpen(root([]))).toBe(false);
  });

  it("finds an open Radix dialog or popover, or an alert dialog", () => {
    expect(otherDialogOpen(root([el("dialog", { state: "open" })]))).toBe(true);
    expect(otherDialogOpen(root([el("dialog"), el("alertdialog")]))).toBe(true);
  });
});

describe("insert hint", () => {
  it("names the agent by alias, else its CLI, a shell as shell", () => {
    expect(targetName("terminal", { alias: "lupus", cliType: "claude-code" })).toBe("lupus");
    expect(targetName("terminal", { cliType: "codex" })).toBe("codex");
    expect(targetName("terminal", { cliType: "shell" })).toBe("shell");
    expect(targetName("terminal")).toBe("the terminal");
    expect(targetName("browser")).toBe("Browser");
  });

  it("says whether Enter is sent", () => {
    expect(insertHint("terminal", "shell", false)).toBe("Inserts into shell (no Enter sent)");
    expect(insertHint("terminal", "shell", true)).toBe("Inserts into shell (then presses Enter)");
    expect(insertHint("browser", "", false)).toBe("Inserts into the browser field");
    expect(insertHint("clipboard", "", false)).toBe("Copies to the clipboard");
  });
});
