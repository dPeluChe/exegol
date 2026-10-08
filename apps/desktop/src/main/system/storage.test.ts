import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStorageReport,
  clearOldLogs,
  clearScreenshots,
  dirSize,
  duBytes,
  resolveOtherTarget,
  worktreeSizes,
} from "./storage";

function write(path: string, bytes: number) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, Buffer.alloc(bytes));
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "exegol-storage-"));
  const exegolDir = join(root, "exegol");
  const userData = join(root, "userData");
  const logDir = join(exegolDir, "logs");
  write(join(exegolDir, "models", "m", "enc.onnx"), 1000);
  write(join(exegolDir, "screenshots", "a.jpg"), 200);
  write(join(exegolDir, "ring-evicted", "s.bin"), 50);
  write(join(logDir, "exegol.log"), 30);
  write(join(logDir, "exegol.1.log"), 20);
  write(join(logDir, "exegol.2.log"), 20);
  write(join(logDir, "sidecar.log"), 10);
  write(join(exegolDir, "worktrees", "proj", "wt", "file.ts"), 400);
  write(join(exegolDir, "pipelines", "proj", "run", "file.ts"), 100);
  write(join(exegolDir, "hooks", "h.json"), 7);
  write(join(userData, "scrollback", "a.log"), 300);
  write(join(userData, "exegol.db"), 500);
  write(join(userData, "exegol.db-wal"), 60);
  write(join(userData, "Partitions", "project-abc", "Cache", "c"), 80);
  write(join(userData, "Partitions", "project-abc", "Cookies"), 5);
  write(join(userData, "Preferences"), 3);
  return { root, paths: { exegolDir, userData, logDir } };
}

describe("storage", () => {
  it("dirSize sums files and does not follow links", async () => {
    const { root } = fixture();
    const linkDir = join(root, "links");
    mkdirSync(linkDir);
    symlinkSync(join(root, "exegol"), join(linkDir, "loop"));
    write(join(linkDir, "f"), 9);
    expect(await dirSize(linkDir)).toBe(9);
    expect(await dirSize(join(root, "missing"))).toBe(0);
  });

  it("aggregates each category once and the rest as Other", async () => {
    const { paths } = fixture();
    const report = await buildStorageReport(paths, [{ id: "ABC", name: "Proj" }]);
    const { worktrees, ...bytes } = Object.fromEntries(
      report.rows.map((r) => [r.category, r.bytes]),
    );
    // du counts allocated blocks, so worktrees round up from the 500 bytes written
    expect(worktrees).toBeGreaterThanOrEqual(500);
    expect(bytes).toEqual({
      models: 1000,
      scrollback: 350,
      screenshots: 200,
      logs: 80,
      database: 560,
      browser: 85,
      other: 10,
    });
    expect(report.totalBytes).toBe(2285 + (worktrees ?? 0));
    // Chromium lowercases partition folders; the project id keeps its case
    expect(report.browserPartitions).toEqual([
      { projectId: "ABC", projectName: "Proj", bytes: 85, cacheBytes: 80 },
    ]);
    expect(report.freeBytes).toBeGreaterThan(0);
  });

  it("breaks Other down into the uncounted top-level entries of both roots", async () => {
    const { paths } = fixture();
    write(join(paths.userData, "GPUCache", "data_0"), 40);
    mkdirSync(join(paths.exegolDir, "empty"));
    const report = await buildStorageReport(paths, []);
    expect(report.otherEntries).toEqual([
      { root: "userData", name: "GPUCache", bytes: 40, isDir: true },
      { root: "exegol", name: "hooks", bytes: 7, isDir: true },
      { root: "userData", name: "Preferences", bytes: 3, isDir: false },
    ]);
    expect(report.rows.find((r) => r.category === "other")?.bytes).toBe(50);
  });

  it("sizes worktrees by id, 0 when the folder is gone", async () => {
    const { paths } = fixture();
    const sizes = await worktreeSizes([
      { id: "w1", path: join(paths.exegolDir, "worktrees", "proj", "wt") },
      { id: "w2", path: join(paths.exegolDir, "worktrees", "proj", "gone") },
    ]);
    expect(sizes.w1).toBeGreaterThanOrEqual(400);
    expect(sizes.w2).toBe(0);
  });

  it("sizes a worktree null, not 0, when measuring fails", async () => {
    const { paths } = fixture();
    const path = join(paths.exegolDir, "worktrees", "proj", "wt");
    const sizes = await worktreeSizes([{ id: "w1", path }], async () => null);
    expect(sizes).toEqual({ w1: null });
    expect(await duBytes(join(paths.exegolDir, "missing"))).toBeNull();
  });

  it("opens only an Other entry the cached report lists, never a link", async () => {
    const { paths } = fixture();
    write(join(paths.exegolDir, "cache", "c"), 4);
    expect((await resolveOtherTarget(paths, null, "exegol", "hooks")).ok).toBe(false);

    const report = await buildStorageReport(paths, []);
    expect(await resolveOtherTarget(paths, report, "exegol", "hooks")).toEqual({
      ok: true,
      target: join(paths.exegolDir, "hooks"),
      isDir: true,
    });
    expect(await resolveOtherTarget(paths, report, "exegol", "models")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not listed"),
    });

    // Swapped for a link after the report was taken
    rmSync(join(paths.exegolDir, "cache"), { recursive: true });
    symlinkSync(paths.userData, join(paths.exegolDir, "cache"));
    expect(await resolveOtherTarget(paths, report, "exegol", "cache")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("link"),
    });
  });

  it("clears screenshots and only the rotated logs", async () => {
    const { paths } = fixture();
    await clearScreenshots(paths.exegolDir);
    expect(readdirSync(join(paths.exegolDir, "screenshots"))).toEqual([]);
    expect(await clearOldLogs(paths.logDir)).toBe(2);
    expect(readdirSync(paths.logDir).sort()).toEqual(["exegol.log", "sidecar.log"]);
  });
});
