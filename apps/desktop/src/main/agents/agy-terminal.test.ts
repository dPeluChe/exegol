import { describe, expect, it } from "vitest";
import { agyTurns } from "./agy-terminal";

const INPUT_BOX = ["─".repeat(60), "> ", "─".repeat(60), "? for shortcuts"];

describe("agyTurns", () => {
  it("splits prompts, activity and answers, and leaves out the banner and the input box", () => {
    const turns = agyTurns(
      [
        "  ▄▀▀ banner",
        "─".repeat(60),
        "> review the diff",
        "  and report",
        "",
        "○ Thought for 2m 2s (The script appears isolated...)",
        "● Ran 14 commands (+7 · trs git show) (ctrl+o to expand)",
        "▸ Thought for 35s, 4.2k tokens",
        "",
        "  ### Verdict",
        "  • one",
        "",
        ...INPUT_BOX,
      ],
      100,
    );
    expect(turns?.map((t) => [t.role, t.text])).toEqual([
      ["user", "review the diff and report"],
      ["tool", "Thought for 2m 2s"],
      ["tool", "Ran 14 commands"],
      ["tool", "Thought for 35s"],
      ["assistant", "### Verdict  \n- one"],
    ]);
    expect(turns?.[0]?.id).toBe("term:102");
  });

  it("joins what the TUI wrapped, keeps short lines apart, and fences tables", () => {
    const long = `  ${"word ".repeat(16).trim()}`;
    const [answer] =
      agyTurns(
        ["> go", "", long, "  rest of it", "", "  def has():", "  return", "  │ a │ b │"],
        0,
      )?.slice(1) ?? [];
    expect(answer?.text).toBe(
      `${long.trim()} rest of it\n\ndef has():  \nreturn\n\`\`\`\n│ a │ b │\n\`\`\``,
    );
  });

  it("gives up on a screen with no prompt", () => {
    expect(agyTurns(["plain output"], 0)).toBeNull();
  });
});
