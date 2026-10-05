import { describe, expect, it } from "vitest";
import { readScreenDialog } from "./screen-dialog";

describe("readScreenDialog", () => {
  it("reads Claude's permission prompt: question, what runs, numbered options", () => {
    const screen = [
      "⏺ I'll run the tests.",
      "╭──────────────────────────────────────╮",
      "│ Bash command                          │",
      "│   bun run test                        │",
      "│ Do you want to proceed?               │",
      "│ ❯ 1. Yes                              │",
      "│   2. Yes, and don't ask again for bun │",
      "│   3. No, and tell Claude what to do   │",
      "╰──────────────────────────────────────╯",
      "",
      ...Array(20).fill(""),
    ];
    const d = readScreenDialog(screen);
    expect(d?.question).toBe("Do you want to proceed?");
    expect(d?.context).toContain("bun run test");
    expect(d?.options.map((o) => o.key)).toEqual(["1", "2", "3"]);
    expect(d?.options[2]?.label).toBe("No, and tell Claude what to do");
  });

  it("reads the real Claude Code 2.1.289 prompt (captured from a live session)", () => {
    const rule = "╌".repeat(100);
    const screen = [
      "⏺ Bash(rm /tmp/t/hello.txt)",
      "  ⎿  Waiting…",
      "─".repeat(100),
      " Bash command",
      " Delete the hello.txt file",
      rule,
      " rm /tmp/t/hello.txt",
      rule,
      " Do you want to proceed?",
      " ❯ 1. Yes",
      "   2. Yes, and always allow access to /tmp/t from this project",
      "   3. No",
      " Esc to cancel · Tab to amend",
      ...Array(5).fill(""),
    ];
    expect(readScreenDialog(screen)).toMatchObject({
      question: "Do you want to proceed?",
      context: ["Bash command", "Delete the hello.txt file", "rm /tmp/t/hello.txt"],
      options: [
        { key: "1", label: "Yes" },
        { key: "2", label: "Yes, and always allow access to /tmp/t from this project" },
        { key: "3", label: "No" },
      ],
    });
  });

  it("Claude's trust gate has no numbers: never offered", () => {
    expect(
      readScreenDialog([
        " ❯ No, exit",
        "   Yes, I trust this folder",
        " Enter to confirm · Esc to cancel",
      ]),
    ).toBeNull();
  });

  it("is not a dialog: options out of order, a lone numbered line, or output after them", () => {
    expect(readScreenDialog(["  2. second", "  1. first"])).toBeNull();
    expect(readScreenDialog(["1. only one step"])).toBeNull();
    expect(
      readScreenDialog(["1. a", "2. b", "more output", "and more", "and more", "x", "y"]),
    ).toBeNull();
  });
});
