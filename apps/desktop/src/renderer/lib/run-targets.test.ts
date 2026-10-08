import { describe, expect, it } from "vitest";
import { pickRunTarget, RUN_IN_COLLAPSED, visibleRunTargets } from "./run-targets";

const target = (rel: string, scripts: string[] = []) => ({
  rel,
  scripts: scripts.map((command) => ({ command })),
});
const many = (n: number) => [
  target(""),
  ...Array.from({ length: n - 1 }, (_, i) => target(`f${i}`)),
];

describe("visibleRunTargets", () => {
  it("shows every folder up to the threshold, no filter", () => {
    const r = visibleRunTargets(many(12), { query: "", expanded: false, selectedRel: "" });
    expect(r).toMatchObject({ hidden: 0, filterable: false });
    expect(r.shown).toHaveLength(12);
  });

  it("folds a long list behind +N and keeps the selected chip visible", () => {
    const targets = many(14);
    const r = visibleRunTargets(targets, { query: "", expanded: false, selectedRel: "f12" });
    expect(r.filterable).toBe(true);
    expect(r.shown).toHaveLength(RUN_IN_COLLAPSED + 1);
    expect(r.shown.at(-1)?.rel).toBe("f12");
    expect(r.hidden).toBe(14 - RUN_IN_COLLAPSED - 1);
    expect(
      visibleRunTargets(targets, { query: "", expanded: true, selectedRel: "" }).shown,
    ).toHaveLength(14);
  });

  it("filters by name, root included, case-insensitive", () => {
    const targets = [...many(13), target("IdeaBooks")];
    expect(
      visibleRunTargets(targets, { query: " ideab ", expanded: false, selectedRel: "" }).shown.map(
        (t) => t.rel,
      ),
    ).toEqual(["IdeaBooks"]);
    expect(
      visibleRunTargets(targets, { query: "root", expanded: false, selectedRel: "" }).shown,
    ).toHaveLength(1);
  });
});

describe("pickRunTarget", () => {
  const targets = [target(""), target("api", ["dev"]), target("web")];
  it("keeps the chosen folder while it exists", () => {
    expect(pickRunTarget(targets, "web", undefined)?.rel).toBe("web");
  });
  it("falls back to the pinned folder, then the first subfolder, when the choice is gone", () => {
    expect(pickRunTarget(targets, "gone", "api")?.rel).toBe("api");
    expect(pickRunTarget(targets, "gone", undefined)?.rel).toBe("api");
    expect(pickRunTarget([target("")], "gone", undefined)?.rel).toBe("");
  });
});
