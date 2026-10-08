import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  grantPreview,
  previewCsp,
  previewGrant,
  previewMime,
  previewRootFor,
  resolvePreviewFile,
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
  mkdirSync(join(root, "sub", "deeper"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, "index.html"), "<h1>hi</h1>");
  writeFileSync(join(root, "css", "style.css"), "body{}");
  writeFileSync(join(root, "my page.html"), "x");
  writeFileSync(join(root, ".env"), "SECRET=1");
  writeFileSync(join(root, ".git", "config"), "[core]");
  writeFileSync(join(root, "server.pem"), "key");
  writeFileSync(join(outside, "secret.txt"), "nope");
  symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
  symlinkSync(outside, join(root, "linked-dir"));
  symlinkSync(join(root, ".env"), join(root, "env.txt"));
  symlinkSync(join(root, "css", "style.css"), join(root, "alias.css"));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("resolvePreviewFile", () => {
  it("serves files under the root, URL-encoded names included", async () => {
    expect(await resolvePreviewFile(root, "/index.html")).toBe(join(root, "index.html"));
    expect(await resolvePreviewFile(root, "/css/style.css")).toBe(join(root, "css/style.css"));
    expect(await resolvePreviewFile(root, "/my%20page.html")).toBe(join(root, "my page.html"));
    expect(await resolvePreviewFile(root, "/alias.css")).toBe(join(root, "css/style.css"));
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
      expect(await resolvePreviewFile(root, p), p).toBeNull();
    }
  });

  it("refuses symlinks that leave the root or land on a dotfile", async () => {
    expect(await resolvePreviewFile(root, "/escape.txt")).toBeNull();
    expect(await resolvePreviewFile(root, "/linked-dir/secret.txt")).toBeNull();
    expect(await resolvePreviewFile(root, "/env.txt")).toBeNull();
  });

  it("refuses dotfiles, dot-folders and credential files", async () => {
    expect(await resolvePreviewFile(root, "/.env")).toBeNull();
    expect(await resolvePreviewFile(root, "/.git/config")).toBeNull();
    expect(await resolvePreviewFile(root, "/server.pem")).toBeNull();
  });

  it("never lists a directory or serves the root itself", async () => {
    expect(await resolvePreviewFile(root, "/")).toBeNull();
    expect(await resolvePreviewFile(root, "/css")).toBeNull();
    expect(await resolvePreviewFile(root, "/sub/deeper/")).toBeNull();
    expect(await resolvePreviewFile(root, "/missing.html")).toBeNull();
  });
});

describe("previewRootFor", () => {
  it("picks the most specific registered base holding the file", async () => {
    const file = join(root, "index.html");
    expect(await previewRootFor(file, [base, root])).toBe(root);
    expect(await previewRootFor(file, [base])).toBe(base);
    expect(await previewRootFor(file, [outside])).toBeNull();
  });
});

describe("grants", () => {
  it("one token per root and script setting, lowercase hex", () => {
    const off = grantPreview(root, false);
    expect(off).toMatch(/^[0-9a-f]{32}$/);
    expect(grantPreview(root, false)).toBe(off);
    expect(grantPreview(root, true)).not.toBe(off);
    expect(previewGrant(off)).toEqual({ root, scripts: false });
    expect(previewGrant("unknown")).toBeNull();
  });
});

describe("previewMime and previewCsp", () => {
  it("names the types pages use, octet-stream otherwise", () => {
    expect(previewMime("a/index.HTML")).toBe("text/html; charset=utf-8");
    expect(previewMime("a.css")).toBe("text/css; charset=utf-8");
    expect(previewMime("a.mjs")).toBe("text/javascript; charset=utf-8");
    expect(previewMime("a.svg")).toBe("image/svg+xml");
    expect(previewMime("a.woff2")).toBe("font/woff2");
    expect(previewMime("a.png")).toBe("image/png");
    expect(previewMime("a.exe")).toBe("application/octet-stream");
    expect(previewMime("Makefile")).toBe("application/octet-stream");
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
