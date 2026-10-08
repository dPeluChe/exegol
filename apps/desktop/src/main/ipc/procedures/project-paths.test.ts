import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("../../db/queries", () => ({ listProjects: () => [] }));

const { resolveProjectFolder } = await import("./project-paths");

const tmp = mkdtempSync(join(tmpdir(), "exegol-folder-"));
const project = join(tmp, "app");
mkdirSync(join(project, "web"), { recursive: true });
mkdirSync(join(tmp, "app-evil"));
writeFileSync(join(project, "README.md"), "");
symlinkSync(join(tmp, "app-evil"), join(project, "escape"));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("resolveProjectFolder", () => {
  it("accepts the root and a subfolder", async () => {
    await expect(resolveProjectFolder(project, project)).resolves.toMatch(/app$/);
    await expect(resolveProjectFolder(project, join(project, "web"))).resolves.toMatch(/web$/);
  });

  it("refuses a sibling with the same prefix, a parent and a symlink out", async () => {
    for (const dir of [join(tmp, "app-evil"), tmp, join(project, "escape"), `${project}/../..`]) {
      await expect(resolveProjectFolder(project, dir)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("refuses a file or a missing folder inside the project", async () => {
    for (const dir of [join(project, "README.md"), join(project, "gone")]) {
      await expect(resolveProjectFolder(project, dir)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
});
