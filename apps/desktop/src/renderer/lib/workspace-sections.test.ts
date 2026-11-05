import { describe, expect, it } from "vitest";
import { groupOf, mainTabOf, SECTION_GROUPS, toggleMainTab } from "./workspace-sections";

describe("workspace sections", () => {
  it("lists every section once", () => {
    const listed = [...SECTION_GROUPS.project, ...SECTION_GROUPS.monitor].flatMap((g) =>
      g.sections.map((s) => s.id),
    );
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("maps a section to its main tab", () => {
    expect(mainTabOf("agents")).toBeNull();
    expect(mainTabOf("knowledge")).toBe("project");
    expect(mainTabOf("qa-tests")).toBe("project");
    expect(mainTabOf("scoring")).toBe("monitor");
  });

  it("finds the group of a section, none for the tabs", () => {
    expect(groupOf("agents")).toBeNull();
    expect(groupOf("knowledge")?.label).toBe("Context");
    expect(groupOf("parallel-runs")?.label).toBe("Automation");
  });

  it("opens a main tab on its first section and closes it back to the tabs", () => {
    expect(toggleMainTab("project", "agents")).toBe("tasks");
    expect(toggleMainTab("monitor", "knowledge")).toBe("usage");
    expect(toggleMainTab("project", "knowledge")).toBe("agents");
    expect(toggleMainTab("monitor", "scoring")).toBe("agents");
  });
});
