import { describe, expect, it } from "vitest";
import {
  countByKind,
  filterSections,
  noteHeadline,
  parseReleaseNotes,
  sectionKind,
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

  it("falls back to the first sentence when the prefix is long or missing", () => {
    expect(
      noteHeadline(
        "Cmd+2..9 and Cmd+0 (Ctrl+Shift on Linux) now always go to a project, never a tab: one each. More",
      ),
    ).toBe(
      "Cmd+2..9 and Cmd+0 (Ctrl+Shift on Linux) now always go to a project, never a tab: one each",
    );
    expect(noteHeadline("Faster start. Then more detail")).toBe("Faster start");
    expect(noteHeadline("No period at all")).toBe("No period at all");
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

  it("maps headings to kinds", () => {
    expect(sectionKind("Added")).toBe("added");
    expect(sectionKind(" fixed ")).toBe("fixed");
    expect(sectionKind("Removed")).toBeNull();
    expect(sectionKind(null)).toBeNull();
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
