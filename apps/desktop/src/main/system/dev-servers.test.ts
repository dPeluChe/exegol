import { describe, expect, it } from "vitest";
import { findAgentAncestor, matchProject, parseEtime } from "./dev-servers";

describe("parseEtime", () => {
  it("reads ps elapsed times", () => {
    expect(parseEtime("05:03")).toBe(303);
    expect(parseEtime("02:05:03")).toBe(7503);
    expect(parseEtime("3-02:05:03")).toBe(3 * 86400 + 7503);
    expect(parseEtime("garbage")).toBeNull();
  });
});

describe("matchProject", () => {
  const projects = [
    { id: "a", path: "/code/app" },
    { id: "b", path: "/code/app/packages/web" },
    { id: "c", path: "/code/app-2" },
  ];
  it("picks the deepest project folder, on a path boundary", () => {
    expect(matchProject("/code/app/packages/web/src", projects)?.id).toBe("b");
    expect(matchProject("/code/app", projects)?.id).toBe("a");
    expect(matchProject("/code/app-2/x", projects)?.id).toBe("c");
    expect(matchProject("/elsewhere", projects)).toBeNull();
    expect(matchProject(null, projects)).toBeNull();
  });
});

describe("findAgentAncestor", () => {
  // shell(100) → pnpm(200) → node vite(300)
  const parentOf = new Map([
    [300, 200],
    [200, 100],
    [100, 1],
  ]);
  it("finds the Exegol terminal up the parent chain", () => {
    expect(findAgentAncestor(300, parentOf, new Set([100]))).toBe(100);
    expect(findAgentAncestor(300, parentOf, new Set([999]))).toBeNull();
  });
});
