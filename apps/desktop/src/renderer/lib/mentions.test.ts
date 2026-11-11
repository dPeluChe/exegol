import { describe, expect, it } from "vitest";
import { applyMention, type Mention, matchMentions, mentionAt } from "./mentions";

const items: Mention[] = [
  { name: "Brow", kind: "project" },
  { name: "browdev", kind: "session", detail: "Brow" },
  { name: "onyx", kind: "session", detail: "Brow" },
  { name: "Tasky", kind: "project" },
];

describe("mentions in the Commander's chat", () => {
  it("finds the @word before the caret, not an email or a finished one", () => {
    expect(mentionAt("ask @br", 7)).toEqual({ start: 4, query: "br" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("me@site", 7)).toBeNull();
    expect(mentionAt("ask @onyx now", 13)).toBeNull();
  });

  it("offers names that start with the query before those that contain it", () => {
    expect(matchMentions(items, "br").map((m) => m.name)).toEqual(["Brow", "browdev", "onyx"]);
    expect(matchMentions(items, "zz")).toEqual([]);
  });

  it("replaces the typed word with the name and leaves the caret after it", () => {
    expect(applyMention("ask @br to go", 4, 7, "browdev")).toEqual({
      text: "ask @browdev to go",
      caret: 13,
    });
  });
});
