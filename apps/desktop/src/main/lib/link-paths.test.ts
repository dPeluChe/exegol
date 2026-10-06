import { describe, expect, it } from "vitest";
import { resolveLinkPath } from "./link-paths";

describe("resolveLinkPath", () => {
  const cwd = "/repo/wt";
  const home = "/Users/me";

  it("resolves relative paths against the session cwd", () => {
    expect(resolveLinkPath("src/app.ts", cwd, home)).toBe("/repo/wt/src/app.ts");
    expect(resolveLinkPath("./foo/bar.tsx", cwd, home)).toBe("/repo/wt/foo/bar.tsx");
    expect(resolveLinkPath("../other/x.md", cwd, home)).toBe("/repo/other/x.md");
  });

  it("expands ~/ against home and keeps absolute paths", () => {
    expect(resolveLinkPath("~/notes/a.md", cwd, home)).toBe("/Users/me/notes/a.md");
    expect(resolveLinkPath("/Users/x/proj/README.md", cwd, home)).toBe("/Users/x/proj/README.md");
  });

  it("normalizes dot segments", () => {
    expect(resolveLinkPath("/a/b/../c.ts", cwd, home)).toBe("/a/c.ts");
  });
});
