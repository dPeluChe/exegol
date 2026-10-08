import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dropPreviewGrant,
  grantPreview,
  isLiveRoot,
  isRecentGesture,
  linkNotice,
  parseRange,
  previewCsp,
  previewGrant,
  previewRootFor,
  previewTokenOf,
  previewUrlFor,
  refusalMessage,
  resolvePreviewFile,
  segmentsFromUrlPath,
} from "./preview-paths";

let base: string;
let root: string;
let outside: string;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "exegol-preview-")));
  root = join(base, "site");
  outside = join(base, "outside");
  mkdirSync(join(root, "css"), { recursive: true });
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, ".vitepress", "dist"), { recursive: true });
  mkdirSync(join(root, "sub", "deeper"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, "index.html"), "<h1>hi</h1>");
  writeFileSync(join(root, "css", "style.css"), "body{}");
  writeFileSync(join(root, "my page.html"), "x");
  writeFileSync(join(root, "100%.html"), "percent");
  writeFileSync(join(root, "a%41.html"), "literal");
  writeFileSync(join(root, "aA.html"), "decoded");
  writeFileSync(join(root, ".env"), "SECRET=1");
  writeFileSync(join(root, ".git", "config"), "[core]");
  writeFileSync(join(root, ".vitepress", "dist", "index.html"), "built");
  writeFileSync(join(root, "server.pem"), "key");
  writeFileSync(join(outside, "secret.txt"), "nope");
  symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
  symlinkSync(outside, join(root, "linked-dir"));
  symlinkSync(join(root, ".env"), join(root, "env.txt"));
  symlinkSync(join(root, "css", "style.css"), join(root, "alias.css"));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

/** What the protocol handler does with a request path */
async function viaUrl(urlPath: string) {
  const segments = segmentsFromUrlPath(urlPath);
  return segments ? resolvePreviewFile(root, segments) : { ok: false, reason: "bad-path" };
}

const served = (path: string) => ({ ok: true, path: join(root, path) });

describe("resolvePreviewFile", () => {
  it("serves files under the root, URL-encoded names included", async () => {
    expect(await viaUrl("/index.html")).toEqual(served("index.html"));
    expect(await viaUrl("/css/style.css")).toEqual(served("css/style.css"));
    expect(await viaUrl("/my%20page.html")).toEqual(served("my page.html"));
    expect(await viaUrl("/alias.css")).toEqual(served("css/style.css"));
  });

  it("names with % round-trip through the URL to the same file", async () => {
    for (const name of ["100%.html", "a%41.html", "my page.html"]) {
      expect(await resolvePreviewFile(root, [name])).toEqual(served(name));
      const url = previewUrlFor("tok", [name]);
      expect(await viaUrl(new URL(url).pathname)).toEqual(served(name));
    }
  });

  it("refuses traversal, raw or encoded", async () => {
    for (const p of [
      "/../outside/secret.txt",
      "/sub/../../outside/secret.txt",
      "/%2e%2e/outside/secret.txt",
      "/..%2foutside%2fsecret.txt",
      "/sub%2f..%2f..%2foutside%2fsecret.txt",
      "/%2E%2E%5Coutside%5Csecret.txt",
      "/index.html%00.png",
      "/%E0%A4%A",
    ]) {
      expect(await viaUrl(p), p).toMatchObject({ ok: false, reason: "bad-path" });
    }
  });

  it("refuses symlinks that leave the root or land on a dotfile, and says why", async () => {
    expect(await viaUrl("/escape.txt")).toEqual({ ok: false, reason: "outside-root" });
    expect(await viaUrl("/linked-dir/secret.txt")).toEqual({ ok: false, reason: "outside-root" });
    expect(await viaUrl("/env.txt")).toEqual({ ok: false, reason: "hidden", name: ".env" });
  });

  it("refuses dotfiles, dot-folders and credential files, naming them", async () => {
    expect(await viaUrl("/.env")).toEqual({ ok: false, reason: "hidden", name: ".env" });
    const git = await viaUrl("/.git/config");
    expect(git).toEqual({ ok: false, reason: "hidden", name: ".git" });
    expect(await viaUrl("/.vitepress/dist/index.html")).toMatchObject({ reason: "hidden" });
    expect(await viaUrl("/server.pem")).toEqual({
      ok: false,
      reason: "sensitive",
      name: "server.pem",
    });
    expect(refusalMessage({ reason: "hidden", name: ".git" })).toContain(".git");
  });

  it("never lists a directory or serves the root itself", async () => {
    expect(await viaUrl("/")).toMatchObject({ reason: "bad-path" });
    expect(await viaUrl("/css")).toMatchObject({ reason: "not-a-file" });
    expect(await viaUrl("/sub/deeper/")).toMatchObject({ reason: "not-a-file" });
    expect(await viaUrl("/missing.html")).toMatchObject({ reason: "not-a-file" });
  });
});

describe("roots and grants", () => {
  it("picks the most specific registered base holding the file", async () => {
    const file = join(root, "index.html");
    expect(await previewRootFor(file, [base, root])).toBe(root);
    expect(await previewRootFor(file, [base])).toBe(base);
    expect(await previewRootFor(file, [outside])).toBeNull();
  });

  it("a root is live only while it is still a base", async () => {
    expect(await isLiveRoot(root, [base, root])).toBe(true);
    expect(await isLiveRoot(root, [base])).toBe(false);
  });

  it("one token per root and script setting, lowercase hex, droppable", () => {
    const off = grantPreview(root, false);
    expect(off).toMatch(/^[0-9a-f]{32}$/);
    expect(grantPreview(root, false)).toBe(off);
    expect(grantPreview(root, true)).not.toBe(off);
    expect(previewGrant(off)).toEqual({ root, scripts: false });
    dropPreviewGrant(off);
    expect(previewGrant(off)).toBeNull();
    expect(previewTokenOf(`exegol-preview://${off}/a/b.html?x#y`)).toBe(off);
    expect(previewTokenOf("https://example.com/")).toBe("");
  });
});

describe("parseRange", () => {
  it("reads one bytes= range against the size", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=9-3", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseRange("items=0-1", 100)).toBeNull();
  });
});

describe("links and CSP", () => {
  it("a link shows its host, without query or fragment", () => {
    expect(linkNotice("https://example.com/a?token=1#x")).toEqual({
      url: "https://example.com/a",
      host: "example.com",
      dropped: true,
    });
    expect(linkNotice("http://localhost:3000/")).toMatchObject({ dropped: false });
    expect(linkNotice("file:///etc/passwd")).toBeNull();
    expect(linkNotice("javascript:alert(1)")).toBeNull();
  });

  it("only a recent click or key press counts as asking", () => {
    expect(isRecentGesture(undefined, 1_000)).toBe(false);
    expect(isRecentGesture(1_000, 1_500)).toBe(true);
    expect(isRecentGesture(1_000, 2_500)).toBe(false);
  });

  it("allows only the preview scheme; scripts only when asked", () => {
    const off = previewCsp(false);
    expect(off).toContain("default-src 'none'");
    expect(off).toContain("script-src 'none'");
    expect(off).toContain("connect-src 'none'");
    expect(off).toContain("form-action 'none'");
    expect(off).not.toMatch(/https?:|\*/);
    const on = previewCsp(true);
    expect(on).toContain("script-src exegol-preview: 'unsafe-inline'");
    expect(on).toContain("connect-src exegol-preview:");
    expect(on).not.toMatch(/https?:|\*/);
  });
});
