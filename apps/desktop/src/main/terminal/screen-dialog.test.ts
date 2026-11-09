import { describe, expect, it } from "vitest";
import { awaitsConfirm, readScreenDialog } from "./screen-dialog";

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

  const picker = [
    "── Cmd+, · Spaces panel ──",
    "¿Qué hace Cmd+, (el atajo de menú de Settings)?",
    "❯ 1 Sí, Cmd+, abre settings",
    "    El problema está en el cableado nuevo del botón",
    "  2 No, Cmd+, tampoco hace nada",
    "    openSettings falla en runtime",
    "  3 Aún no lo pruebo",
    "    Lo pruebo y te digo",
    "  Other (type your own)",
    "─".repeat(60),
    "  enter to select · esc to cancel",
  ];

  it("reads a picker with help lines and an unnumbered Other, as Devin draws it", () => {
    const d = readScreenDialog([...Array(10).fill("text"), ...picker, ...Array(5).fill("")]);
    expect(d?.picked).toBe(true);
    expect(d?.question).toBe("¿Qué hace Cmd+, (el atajo de menú de Settings)?");
    expect(d?.options.map((o) => o.label)).toEqual([
      "Sí, Cmd+, abre settings",
      "No, Cmd+, tampoco hace nada",
      "Aún no lo pruebo",
    ]);
  });

  it("reads a picker with the selection moved down, in Claude's numbered form", () => {
    const d = readScreenDialog([
      "Which approach?",
      "  1. First",
      "     why first",
      "❯ 2. Second",
      "     why second",
      "  3. Type something.",
    ]);
    expect(d?.options.map((o) => o.key)).toEqual(["1", "2", "3"]);
    expect(d?.picked).toBe(true);
  });

  it("marks a numbered list in an answer as not picked", () => {
    const d = readScreenDialog(["Two options:", "1. Keep it", "2. Remove it"]);
    expect(d?.picked).toBe(false);
  });

  it("does not read a prompt line that merely starts with a number", () => {
    expect(readScreenDialog(["some output", "❯ 3 files changed", "  esc to cancel"])).toBeNull();
  });

  it("reads the > a console without the glyph draws, but not a quoted list", () => {
    const picked = readScreenDialog(["Which one?", "> 1. First", "  2. Second", "  3. Third"]);
    expect(picked?.picked).toBe(true);
    expect(picked?.options.map((o) => o.key)).toEqual(["1", "2", "3"]);
    expect(readScreenDialog(["He said:", "> 1. First", "> 2. Second"])?.picked).not.toBe(true);
  });
});

describe("awaitsConfirm", () => {
  it("holds for Claude's trust gate, not for a prompt or an answer that quotes one", () => {
    const gate = [
      " Quick safety check: Is this a project you created or one you trust?",
      " Security guide",
      " ❯ No, exit",
      "   Yes, I trust this folder",
      " Enter to confirm · Esc to cancel",
      "",
    ];
    expect(awaitsConfirm(gate)).toBe(true);
    expect(awaitsConfirm(["⏺ Done.", "❯ ", "  ? for shortcuts"])).toBe(false);
    expect(awaitsConfirm([...gate, "⏺ a", "b", "c", "d", "❯ "])).toBe(false);
  });
});
