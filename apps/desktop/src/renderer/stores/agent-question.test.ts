import { describe, expect, it } from "vitest";
import { guessesQuestion } from "./agent-state";

describe("guessesQuestion", () => {
  const agy = { cliType: "agy", status: "running" } as const;

  it("reads a scraped move from work to the prompt as a possible question", () => {
    expect(guessesQuestion(agy, {})).toBe(true);
  });

  it("leaves a turn end the CLI reported itself", () => {
    expect(guessesQuestion(agy, { reported: true })).toBe(false);
  });

  it("leaves Claude, an idle prompt and a session already waiting", () => {
    expect(guessesQuestion({ cliType: "claude-code", status: "running" }, {})).toBe(false);
    expect(guessesQuestion(agy, { idleOnly: true })).toBe(false);
    expect(guessesQuestion({ cliType: "agy", status: "waiting_input" }, {})).toBe(false);
  });
});
