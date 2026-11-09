import { describe, expect, it } from "vitest";
import { speechSentences } from "./speech-text";

describe("speechSentences", () => {
  it("reads prose without Markdown syntax, in sentences", () => {
    const reply = "## Estado\n\n**Tres** sesiones terminaron. Una *espera* tu respuesta.\n";
    expect(speechSentences(reply)).toEqual([
      "Estado.",
      "Tres sesiones terminaron.",
      "Una espera tu respuesta.",
    ]);
  });

  it("skips code blocks, an unclosed fence and tables entirely", () => {
    const reply = [
      "Before.",
      "```ts",
      "const x = 1;",
      "```",
      "| Session | State |",
      "|---|---|",
      "| api | done |",
      "",
      "After.",
      "~~~",
      "never read",
    ].join("\n");
    expect(speechSentences(reply)).toEqual(["Before.", "After."]);
  });

  it("keeps link text, reads a URL as its host and drops images", () => {
    const reply =
      "See [the PR](https://github.com/a/b/pull/1) and https://www.example.com/x?y=1 ![shot](a.png) now";
    expect(speechSentences(reply)).toEqual(["See the PR and example.com now."]);
  });

  it("makes each list item a sentence and keeps short inline code as words", () => {
    const reply =
      "- run `bun test`\n- `a very long inline snippet that is clearly code, not prose` ok\n1. done";
    expect(speechSentences(reply)).toEqual(["run bun test.", "ok.", "done."]);
  });

  it("leaves snake_case and paths alone, drops emoji and rules", () => {
    expect(speechSentences("Check my_var_name 🚀\n\n---\n\nOK")).toEqual([
      "Check my_var_name.",
      "OK.",
    ]);
  });

  it("caps the total at a word boundary and cuts a very long sentence", () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const out = speechSentences(words, 100);
    expect(out.join(" ").length).toBeLessThanOrEqual(101);
    expect(out.at(-1)).toMatch(/word\d+\.$/);
    const long = speechSentences(`${words}.`);
    expect(long.length).toBeGreaterThan(1);
    expect(long.every((s) => s.length <= 280)).toBe(true);
  });

  it("returns nothing for a reply that is only code", () => {
    expect(speechSentences("```\nls\n```")).toEqual([]);
    expect(speechSentences("")).toEqual([]);
  });
});
