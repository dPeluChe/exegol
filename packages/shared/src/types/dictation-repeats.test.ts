import { describe, expect, it } from "vitest";
import { cleanDictation, dictationSettingsOf } from "./dictation";
import { collapseRepeats } from "./dictation-repeats";

const c = (text: string) => collapseRepeats(text).text;

describe("collapseRepeats: Spanish", () => {
  it("collapses a term the engine wrote over a filler", () => {
    expect(c("Bueno. Claude Claude Claude Claude Claude. Y luego")).toBe("Bueno. Claude. Y luego");
    expect(collapseRepeats("le pides a Claude Claude Claude que haga").collapsed).toBe(1);
  });

  it("compares without case or punctuation", () => {
    expect(c("Claude, claude. CLAUDE que revise")).toBe("Claude que revise");
    expect(c("este, este, este, no sé")).toBe("este, no sé");
  });

  it("collapses phrases of up to 3 words", () => {
    expect(c("abre el pull request pull request pull request ya")).toBe("abre el pull request ya");
    expect(c("a ver si a ver si a ver si funciona")).toBe("a ver si funciona");
  });

  it("keeps two in a row", () => {
    expect(c("no no, eso no")).toBe("no no, eso no");
    expect(collapseRepeats("este este bueno").collapsed).toBe(0);
  });
});

describe("collapseRepeats: English", () => {
  it("collapses words and short phrases", () => {
    expect(c("ask Claude Claude Claude Claude to commit")).toBe("ask Claude to commit");
    expect(c("run the run the run the linter")).toBe("run the linter");
    expect(collapseRepeats("one two, one two, one two. Done").text).toBe("one two. Done");
  });

  it("keeps normal text and counts each run", () => {
    expect(c("that that is fine")).toBe("that that is fine");
    const out = collapseRepeats("go go go and stop stop stop");
    expect(out).toEqual({ text: "go and stop", collapsed: 2 });
  });
});

describe("cleanDictation collapses before spoken punctuation", () => {
  it("in both languages", () => {
    expect(cleanDictation("Claude Claude Claude revisa coma ya", { spokenPunctuation: true })).toBe(
      "Claude revisa, ya",
    );
    expect(cleanDictation("bug bug bug bug fixed", { spokenPunctuation: false })).toBe("bug fixed");
  });
});

describe("dictationSettingsOf: vocabulary boost", () => {
  it("resets a boost off the scale to the default", () => {
    expect(dictationSettingsOf({ vocabularyBoost: 5 }).vocabularyBoost).toBe(2);
    expect(dictationSettingsOf({ vocabularyBoost: 1.5 }).vocabularyBoost).toBe(2);
    expect(dictationSettingsOf({ vocabularyBoost: 3 }).vocabularyBoost).toBe(3);
  });
});
