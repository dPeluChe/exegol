import { describe, expect, it } from "vitest";
import { matchProjectByPath } from "./deeplink-match";

const projects = [
  { id: "a", path: "/Users/foo/repo" },
  { id: "b", path: "/Users/foo/repo/packages/nested" },
  { id: "c", path: "/Users/foo/other" },
];

describe("matchProjectByPath", () => {
  it("matches exact path", () => {
    expect(matchProjectByPath(projects, "/Users/foo/repo")?.id).toBe("a");
  });

  it("ignores trailing slashes on both sides", () => {
    expect(matchProjectByPath(projects, "/Users/foo/repo/")?.id).toBe("a");
    expect(matchProjectByPath([{ id: "x", path: "/tmp/p/" }], "/tmp/p")?.id).toBe("x");
  });

  it("matches the deepest ancestor project for subdirectory paths", () => {
    expect(matchProjectByPath(projects, "/Users/foo/repo/src/lib")?.id).toBe("a");
    expect(matchProjectByPath(projects, "/Users/foo/repo/packages/nested/src")?.id).toBe("b");
  });

  it("does not match sibling prefixes (repo vs repo-two)", () => {
    expect(matchProjectByPath(projects, "/Users/foo/repo-two")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchProjectByPath(projects, "/somewhere/else")).toBeNull();
    expect(matchProjectByPath([], "/Users/foo/repo")).toBeNull();
  });
});
