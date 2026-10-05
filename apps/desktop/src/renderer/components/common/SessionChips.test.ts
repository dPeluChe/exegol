import { describe, expect, it, vi } from "vitest";

vi.mock("../../hooks/use-trpc", () => ({ useProjects: vi.fn() }));
const { groupSessions } = await import("./SessionChips");

const s = (id: string, projectId: string) => ({ id, projectId });

describe("groupSessions", () => {
  it("groups by project in first-seen order", () => {
    const { groups, hidden } = groupSessions([s("a", "p1"), s("b", "p2"), s("c", "p1")], 10);
    expect(groups.map(([p, list]) => [p, list.map((x) => x.id)])).toEqual([
      ["p1", ["a", "c"]],
      ["p2", ["b"]],
    ]);
    expect(hidden).toEqual([]);
  });

  it("hides the sessions past the cap, from the last groups", () => {
    const { groups, hidden } = groupSessions([s("a", "p1"), s("b", "p2"), s("c", "p1")], 2);
    expect(groups.map(([p, list]) => [p, list.map((x) => x.id)])).toEqual([["p1", ["a", "c"]]]);
    expect(hidden.map((x) => x.id)).toEqual(["b"]);
  });
});
