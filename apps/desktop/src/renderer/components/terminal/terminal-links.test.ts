import { describe, expect, it } from "vitest";
import { findFileMatches, findUrlMatches, linkAction, linkClick, linkHint } from "./terminal-links";

describe("findFileMatches", () => {
  it("matches a relative path with line number", () => {
    const m = findFileMatches("error in src/auth/session.ts:42 near token");
    expect(m).toHaveLength(1);
    expect(m[0]?.text).toBe("src/auth/session.ts");
    expect(m[0]?.line).toBe(42);
    expect(m[0]?.index).toBe(9);
    expect(m[0]?.length).toBe("src/auth/session.ts:42".length);
  });

  it("reads line and column", () => {
    const m = findFileMatches("at src/app.ts:42:7 in main");
    expect(m[0]).toMatchObject({ text: "src/app.ts", line: 42, col: 7 });
    expect(m[0]?.length).toBe("src/app.ts:42:7".length);
  });

  it("matches bare filenames, dotted-dir, absolute and home paths", () => {
    expect(findFileMatches("see package.json for scripts")[0]?.text).toBe("package.json");
    expect(findFileMatches("open ./foo/bar.tsx now")[0]?.text).toBe("./foo/bar.tsx");
    expect(findFileMatches("abs /Users/x/proj/README.md here")[0]?.text).toBe(
      "/Users/x/proj/README.md",
    );
    expect(findFileMatches("cat ~/notes/todo.md")[0]?.text).toBe("~/notes/todo.md");
    expect(findFileMatches("up ../lib/a.rs")[0]?.text).toBe("../lib/a.rs");
  });

  it("drops trailing punctuation", () => {
    expect(findFileMatches("I edited src/app.ts.")[0]?.text).toBe("src/app.ts");
    expect(findFileMatches("(see src/app.ts:3)")[0]).toMatchObject({ text: "src/app.ts", line: 3 });
    expect(findFileMatches("files: a/b.ts, c/d.ts;").map((m) => m.text)).toEqual([
      "a/b.ts",
      "c/d.ts",
    ]);
    expect(findFileMatches("done with src/x.ts:12:4.")[0]).toMatchObject({ line: 12, col: 4 });
  });

  it("does not treat domains or URLs as files", () => {
    expect(findFileMatches("visit github.com for more")).toHaveLength(0);
    expect(findFileMatches("docs at example.io today")).toHaveLength(0);
    expect(findFileMatches("see https://github.com/a/b/blob/main/x.ts ok")).toHaveLength(0);
  });

  it("matches multiple files in one row", () => {
    const m = findFileMatches("diff a/src/a.ts b/src/b.ts");
    expect(m.map((x) => x.text)).toEqual(["a/src/a.ts", "b/src/b.ts"]);
  });
});

describe("findUrlMatches", () => {
  it("matches http and https URLs", () => {
    const m = findUrlMatches("open http://localhost:3000/app and https://exegol.dev/docs");
    expect(m.map((x) => x.url)).toEqual(["http://localhost:3000/app", "https://exegol.dev/docs"]);
    expect(m[0]?.index).toBe(5);
  });

  it("never linkifies other schemes", () => {
    expect(findUrlMatches("file:///etc/passwd javascript:alert(1) data:text/html,x")).toEqual([]);
  });

  it("trims prose punctuation and unbalanced brackets", () => {
    expect(findUrlMatches("see https://a.com/x.")[0]?.url).toBe("https://a.com/x");
    expect(findUrlMatches("(https://a.com/x)")[0]?.url).toBe("https://a.com/x");
    expect(findUrlMatches("[docs](https://a.com/x)")[0]?.url).toBe("https://a.com/x");
    expect(findUrlMatches("https://en.wikipedia.org/wiki/A_(b)")[0]?.url).toBe(
      "https://en.wikipedia.org/wiki/A_(b)",
    );
  });

  it("matches scheme-less domains with allowlisted TLDs as https", () => {
    const m = findUrlMatches("see github.com/dPeluChe/exegol for source");
    expect(m).toHaveLength(1);
    expect(m[0]?.url).toBe("https://github.com/dPeluChe/exegol");
    expect(findUrlMatches("app at myapp.dev:3000/dash ok")[0]?.text).toBe("myapp.dev:3000/dash");
    expect(findUrlMatches("go to www.example.com now")[0]?.url).toBe("https://www.example.com");
  });

  it("needs www. or a path for a bare domain", () => {
    expect(findUrlMatches("visit github.com for more")).toHaveLength(0);
  });

  it("reads install.sh and main.app as files, not URLs", () => {
    expect(findUrlMatches("run install.sh then open main.app")).toHaveLength(0);
    expect(findFileMatches("run install.sh now").map((m) => m.text)).toEqual(["install.sh"]);
  });

  it("ignores file extensions as TLDs", () => {
    expect(findUrlMatches("check config.json and main.ts")).toHaveLength(0);
  });
});

describe("URL trimming", () => {
  it("keeps balanced parens and drops trailing prose punctuation", () => {
    const urls = (row: string) => findUrlMatches(row).map((m) => m.url);
    expect(urls("see (https://a.com/b(c)).")).toEqual(["https://a.com/b(c)"]);
    expect(urls("at https://a.com/b*, then")).toEqual(["https://a.com/b"]);
  });
});

describe("linkAction", () => {
  it("routes URLs: click to the pane, modifier to the system browser", () => {
    expect(linkAction("url", "plain")).toBe("pane");
    expect(linkAction("url", "mod")).toBe("browser");
  });

  it("routes files: click by kind, Cmd to the IDE, Cmd+Shift reveals", () => {
    expect(linkAction("file", "plain", "src/app.ts")).toBe("peek");
    expect(linkAction("file", "plain", "shot.png")).toBe("peek");
    expect(linkAction("file", "plain", "docs/spec.pdf")).toBe("system");
    expect(linkAction("file", "plain", "dist/build.zip")).toBe("reveal");
    expect(linkAction("file", "mod", "src/app.ts")).toBe("ide");
    expect(linkAction("file", "modShift", "src/app.ts")).toBe("reveal");
  });

  it("reads Cmd on macOS and Ctrl elsewhere", () => {
    const e = { metaKey: true, ctrlKey: false, shiftKey: true };
    expect(linkClick(e, true)).toBe("modShift");
    expect(linkClick(e, false)).toBe("plain");
    expect(linkClick({ metaKey: false, ctrlKey: true, shiftKey: false }, false)).toBe("mod");
  });
});

describe("linkHint", () => {
  it("names the target and the modifiers per platform", () => {
    expect(linkHint("url", "https://a.com", "https://a.com", true)).toBe(
      "https://a.com\nClick: open in the preview pane · Cmd+click: open in the system browser",
    );
    expect(linkHint("file", "a/b.ts", "a/b.ts:4", false)).toBe(
      "a/b.ts:4\nClick: open here · Ctrl+click: open in the IDE · Ctrl+Shift+click: show in the file manager",
    );
  });
});
