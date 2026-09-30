import { describe, expect, it } from "vitest";
import { parseReleaseNotes } from "./release-notes";

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
