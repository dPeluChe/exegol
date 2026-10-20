import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLinkPath } from "./link-paths";

describe("resolveLinkPath", () => {
  const cwd = "/repo/wt";
  const home = "/Users/me";
  const posix = (text: string) => resolveLinkPath(text, cwd, home, path.posix);

  it("resolves relative paths against the session cwd", () => {
    expect(posix("src/app.ts")).toBe("/repo/wt/src/app.ts");
    expect(posix("./foo/bar.tsx")).toBe("/repo/wt/foo/bar.tsx");
    expect(posix("../other/x.md")).toBe("/repo/other/x.md");
  });

  it("expands ~/ against home and keeps absolute paths", () => {
    expect(posix("~/notes/a.md")).toBe("/Users/me/notes/a.md");
    expect(posix("/Users/x/proj/README.md")).toBe("/Users/x/proj/README.md");
    expect(posix("~\\notes")).toBe("/repo/wt/~\\notes");
  });

  it("normalizes dot segments", () => {
    expect(posix("/a/b/../c.ts")).toBe("/a/c.ts");
  });

  it("on Windows: both separators, drive letters, ~\\ against home", () => {
    const win = (text: string) =>
      resolveLinkPath(text, "C:\\repo\\wt", "C:\\Users\\me", path.win32);
    expect(win("src/app.ts")).toBe("C:\\repo\\wt\\src\\app.ts");
    expect(win("..\\other\\x.md")).toBe("C:\\repo\\other\\x.md");
    expect(win("~\\notes\\a.md")).toBe("C:\\Users\\me\\notes\\a.md");
    expect(win("~/notes/a.md")).toBe("C:\\Users\\me\\notes\\a.md");
    expect(win("D:\\x\\..\\y.ts")).toBe("D:\\y.ts");
    expect(win("d:/x/y.ts")).toBe("d:\\x\\y.ts");
  });
});
