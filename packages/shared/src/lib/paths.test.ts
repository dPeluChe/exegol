import { describe, expect, it } from "vitest";
import {
  isUnderPath,
  pathBase,
  pathBelow,
  pathParent,
  pathSegments,
  pathSep,
  samePath,
} from "./paths";

describe("paths", () => {
  it("takes the last name in either spelling", () => {
    expect(pathBase("/a/b.ts")).toBe("b.ts");
    expect(pathBase("/a/b/")).toBe("b");
    expect(pathBase("C:\\a\\b.ts")).toBe("b.ts");
    expect(pathBase("src/a\\b.ts")).toBe("b.ts");
    expect(pathBase("b.ts")).toBe("b.ts");
    expect(pathBase("/")).toBe("/");
  });

  it("finds the parent, keeping a root", () => {
    expect(pathParent("/a/b.ts")).toBe("/a");
    expect(pathParent("/a")).toBe("/");
    expect(pathParent("/")).toBe("/");
    expect(pathParent("C:\\a\\b.ts")).toBe("C:\\a");
    expect(pathParent("C:\\a")).toBe("C:\\");
    expect(pathParent("C:\\")).toBe("C:\\");
    expect(pathParent("C:/a")).toBe("C:/");
    expect(pathParent("/a/b\\c.txt")).toBe("/a");
  });

  it("compares Windows paths whatever the case or separator, POSIX ones as written", () => {
    expect(samePath("C:\\Repo\\", "c:/repo")).toBe(true);
    expect(samePath("/Repo", "/repo")).toBe(false);
    expect(samePath("/repo/", "/repo")).toBe(true);
  });

  it("knows what sits under a folder", () => {
    expect(isUnderPath("C:/repo/src", "C:\\Repo")).toBe(true);
    expect(isUnderPath("/repo-two/a", "/repo")).toBe(false);
    expect(isUnderPath("/repo", "/repo")).toBe(false);
    expect(isUnderPath("/a", "/")).toBe(false);
  });

  it("gives the part below a folder in the path's spelling", () => {
    expect(pathBelow("/repo/src/a.ts", "/repo/")).toBe("src/a.ts");
    expect(pathBelow("C:\\Repo\\src\\a.ts", "c:/repo")).toBe("src\\a.ts");
    expect(pathBelow("/other/a.ts", "/repo")).toBeNull();
  });

  it("splits in either spelling", () => {
    expect(pathSegments("/a//b/")).toEqual(["a", "b"]);
    expect(pathSegments("C:\\a/b")).toEqual(["C:", "a", "b"]);
  });

  it("names the separator a path uses", () => {
    expect(pathSep("C:\\repo")).toBe("\\");
    expect(pathSep("/repo")).toBe("/");
  });
});
