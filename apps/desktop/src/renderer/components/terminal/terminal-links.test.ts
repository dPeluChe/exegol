import { describe, expect, it } from "vitest";
import { findBareUrlMatches, findFileMatches } from "./terminal-links";

describe("findFileMatches", () => {
  it("matches a relative path with line number", () => {
    const m = findFileMatches("error in src/auth/session.ts:42 near token");
    expect(m).toHaveLength(1);
    expect(m[0]?.text).toBe("src/auth/session.ts");
    expect(m[0]?.line).toBe(42);
    expect(m[0]?.index).toBe(9);
  });

  it("matches bare filenames and dotted-dir paths", () => {
    expect(findFileMatches("see package.json for scripts")[0]?.text).toBe("package.json");
    expect(findFileMatches("open ./lib/utils.rs now")[0]?.text).toBe("./lib/utils.rs");
    expect(findFileMatches("abs /tmp/out.log here")[0]?.text).toBe("/tmp/out.log");
  });

  it("does not treat domains as files", () => {
    expect(findFileMatches("visit github.com for more")).toHaveLength(0);
    expect(findFileMatches("docs at example.io today")).toHaveLength(0);
  });

  it("matches multiple files in one row", () => {
    const m = findFileMatches("diff a/src/a.ts b/src/b.ts");
    expect(m.map((x) => x.text)).toEqual(["a/src/a.ts", "b/src/b.ts"]);
  });
});

describe("findBareUrlMatches", () => {
  it("matches scheme-less domains with allowlisted TLDs", () => {
    const m = findBareUrlMatches("see github.com/dPeluChe/exegol for source");
    expect(m).toHaveLength(1);
    expect(m[0]?.text).toBe("github.com/dPeluChe/exegol");
  });

  it("ignores non-allowlisted TLDs (file extensions)", () => {
    expect(findBareUrlMatches("check config.json and main.ts")).toHaveLength(0);
  });

  it("matches domain with port and path", () => {
    expect(findBareUrlMatches("app at myapp.dev:3000/dash ok")[0]?.text).toBe(
      "myapp.dev:3000/dash",
    );
  });
});
