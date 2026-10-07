import { describe, expect, it } from "vitest";
import {
  countByKind,
  filterSections,
  noteExpands,
  noteHeadline,
  parseReleaseNotes,
} from "./release-notes";

describe("parseReleaseNotes", () => {
  it("groups bullets under their headings", () => {
    const body = "### Added\n- One\n- Two\n\n### Fixed\n- Three";
    expect(parseReleaseNotes(body)).toEqual([
      { title: "Added", items: ["One", "Two"] },
      { title: "Fixed", items: ["Three"] },
    ]);
  });

  it("joins a wrapped bullet and keeps text before any heading", () => {
    expect(parseReleaseNotes("Intro line\n### Changed\n- Long item\n  continues here")).toEqual([
      { title: null, items: ["Intro line"] },
      { title: "Changed", items: ["Long item continues here"] },
    ]);
  });

  it("drops empty sections and an empty body", () => {
    expect(parseReleaseNotes("### Added\n\n### Fixed\n- x")).toEqual([
      { title: "Fixed", items: ["x"] },
    ]);
    expect(parseReleaseNotes("")).toEqual([]);
  });
});

describe("noteHeadline", () => {
  it("uses a short prefix before the first colon", () => {
    expect(noteHeadline("Watch PR: a session's toolbar can watch its branch's pull request")).toBe(
      "Watch PR",
    );
    expect(noteHeadline("Undo a turn: after a turn that changed files: more")).toBe("Undo a turn");
  });

  it("takes a prefix up to 80 characters (real 0.5.15 entries)", () => {
    expect(
      noteHeadline(
        "Ask agent in a browser pane's bar (when the project has live agents): pick the agent (the last one that used the pane by default), add a note and optionally pick a part of the page; it gets the URL, title, your note and the element at its next turn",
      ),
    ).toBe("Ask agent in a browser pane's bar (when the project has live agents)");
    expect(
      noteHeadline(
        "Answer an agent's question without opening its pane: when it waits on a numbered prompt (Claude's \"Do you want to proceed? 1. Yes / 2. Yes, always… / 3. No\", Codex's approval), the Dashboard card and the attention queue show the question",
      ),
    ).toBe("Answer an agent's question without opening its pane");
  });

  it("falls back to the first sentence when the prefix is long or missing", () => {
    expect(
      noteHeadline(
        "Ctrl+Tab no longer steps to the next pane of the tab: a quick press goes back to the pane you used before (like Cmd+Tab between apps), holding Ctrl opens the pane switcher. Cmd+] / Cmd+[ still step through the tab's panes",
      ),
    ).toBe("Ctrl+Tab no longer steps to the next pane of the tab");
    expect(noteHeadline("Faster start. Then more detail")).toBe("Faster start");
    expect(noteHeadline("No period at all")).toBe("No period at all");
  });

  it("does not end a sentence at an abbreviation", () => {
    expect(noteHeadline("Paths open in place, e.g. `src/app.ts`. More detail")).toBe(
      "Paths open in place, e.g. `src/app.ts`",
    );
    expect(noteHeadline("Tabs vs. panes, i.e. both work. Rest")).toBe(
      "Tabs vs. panes, i.e. both work",
    );
  });

  it("returns a one-sentence entry whole, so it does not expand", () => {
    const text =
      "The commit message button (Sparkles) works without an API key, through your logged-in Claude CLI";
    expect(noteHeadline(text)).toBe(text);
    expect(noteHeadline("Faster start.")).toBe("Faster start.");
    expect(noteExpands("Faster start.", noteHeadline("Faster start."))).toBe(false);
    expect(noteExpands("Faster start.", "Faster start")).toBe(false);
    expect(noteExpands("Watch PR: more", noteHeadline("Watch PR: more"))).toBe(true);
  });

  it("cuts a long sentence at a word and keeps code spans closed", () => {
    const long = `${"word ".repeat(30)}end.`;
    const head = noteHeadline(long);
    expect(head.endsWith("word…")).toBe(true);
    expect(head.length).toBeLessThanOrEqual(111);
    const code = `${"a".repeat(60)}\`${"b".repeat(80)}\` tail.`;
    expect(noteHeadline(code)).toMatch(/`…$/);
  });

  it("ignores a colon inside a code span", () => {
    expect(noteHeadline("Set `a: b` in config. Done")).toBe("Set `a: b` in config");
  });
});

describe("sections by kind", () => {
  const sections = parseReleaseNotes(
    "Intro\n### Added\n- A\n- B\n### Changed\n- C\n### Fixed\n- D\n### Removed\n- E",
  );

  it("matches headings to kinds ignoring case and spaces, other headings count for none", () => {
    const mixed = parseReleaseNotes("### added\n- A\n###  Fixed \n- B\n### Removed\n- C\nIntro");
    expect(countByKind(mixed)).toEqual({ added: 1, changed: 0, fixed: 1 });
    expect(filterSections(mixed, "fixed")).toEqual([{ title: "Fixed", items: ["B"] }]);
  });

  it("counts entries per kind", () => {
    expect(countByKind(sections)).toEqual({ added: 2, changed: 1, fixed: 1 });
    expect(countByKind([])).toEqual({ added: 0, changed: 0, fixed: 0 });
  });

  it("filters to one kind, all keeps every section", () => {
    expect(filterSections(sections, "fixed")).toEqual([{ title: "Fixed", items: ["D"] }]);
    expect(filterSections(sections, "all")).toHaveLength(5);
  });
});
