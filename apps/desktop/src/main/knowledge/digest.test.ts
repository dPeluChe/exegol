import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Never the real trs: it would record each call in the developer's ~/.trs history
const trs = vi.hoisted(() => ({ path: null as string | null, run: vi.fn() }));
vi.mock("../agents/spawn-env", () => ({
  findOnPath: (command: string) => (command === "trs" ? trs.path : null),
}));
vi.mock("../lib/exec-file", () => ({ execFileAsync: trs.run }));

import { computeDigest } from "./digest";
import { refreshDigest } from "./staleness";

afterEach(() => {
  trs.path = null;
  trs.run.mockReset();
});

describe("computeDigest via trs ingest", () => {
  it("uses trs ingest's stdout when trs is on PATH", async () => {
    trs.path = "/bin/trs";
    trs.run.mockResolvedValue({ stdout: "# proj (2 files)\n", stderr: "not a git repository" });
    expect(await computeDigest("/p")).toBe("# proj (2 files)");
    expect(trs.run).toHaveBeenCalledWith(
      "/bin/trs",
      ["ingest", "--print", "--budget", "32k", "/p"],
      expect.anything(),
    );
  });

  it("falls back to the internal summary when trs fails or prints nothing", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "exegol-digest-test-"));
    trs.path = "/bin/trs";
    trs.run.mockRejectedValueOnce(new Error("boom"));
    expect(await computeDigest(projectPath)).toContain("Codebase Digest");
    trs.run.mockResolvedValueOnce({ stdout: "  \n", stderr: "" });
    expect(await computeDigest(projectPath)).toContain("Codebase Digest");
    rmSync(projectPath, { recursive: true, force: true });
  });
});

describe("refreshDigest", () => {
  it("runs trs once for overlapping refreshes of one project", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "exegol-digest-test-"));
    trs.path = "/bin/trs";
    trs.run.mockResolvedValue({ stdout: "# digest", stderr: "" });
    const [a, b] = await Promise.all([refreshDigest(projectPath), refreshDigest(projectPath)]);
    expect(a).toBe(b);
    // the same mock also answers the git HEAD read
    expect(trs.run.mock.calls.filter(([bin]) => bin === "/bin/trs")).toHaveLength(1);
    rmSync(projectPath, { recursive: true, force: true });
  });
});

describe("computeDigest (internal fallback summarizer)", () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "exegol-digest-test-"));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("summarizes package.json dependencies", async () => {
    writeFileSync(
      join(projectPath, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^18.0.0" } }),
    );
    const digest = await computeDigest(projectPath);
    expect(digest).toContain("my-app");
    expect(digest).toContain("react");
  });

  it("lists top-level directories with file counts", async () => {
    mkdirSync(join(projectPath, "src"), { recursive: true });
    writeFileSync(join(projectPath, "src", "index.ts"), "export {};");
    writeFileSync(join(projectPath, "src", "util.ts"), "export {};");

    const digest = await computeDigest(projectPath);
    expect(digest).toContain("src/");
    expect(digest).toContain("2 files");
  });

  it("skips ignored directories like node_modules", async () => {
    mkdirSync(join(projectPath, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(projectPath, "node_modules", "pkg", "index.js"), "");
    mkdirSync(join(projectPath, "src"), { recursive: true });
    writeFileSync(join(projectPath, "src", "index.ts"), "export {};");

    const digest = await computeDigest(projectPath);
    expect(digest).not.toContain("node_modules/");
  });

  it("returns a non-empty digest for an empty project", async () => {
    const digest = await computeDigest(projectPath);
    expect(digest).toContain("Codebase Digest");
  });
});
