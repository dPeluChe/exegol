import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { projectShapes } from "./project-shape";

const root = mkdtempSync(join(tmpdir(), "exegol-shape-"));
const dir = (...parts: string[]) => {
  const path = join(root, ...parts);
  mkdirSync(path, { recursive: true });
  return path;
};

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("projectShapes", () => {
  it("tells a repo, a workspace of repos and a plain folder apart", async () => {
    const repo = dir("repo");
    dir("repo", ".git");
    dir("repo", "pkg", ".git");
    const workspace = dir("ws");
    dir("ws", "api", ".git");
    dir("ws", "apps", "web", ".git");
    const folder = dir("plain", "src");

    const shapes = await projectShapes([
      { id: "r", path: repo },
      { id: "w", path: workspace },
      { id: "f", path: join(folder, "..") },
    ]);

    expect(shapes.r).toEqual({ kind: "repo", repoCount: 1, repos: [] });
    expect(shapes.w).toEqual({
      kind: "workspace",
      repoCount: 2,
      repos: ["api", join("apps", "web")],
    });
    expect(shapes.f).toEqual({ kind: "folder", repoCount: 0, repos: [] });
  });
});
