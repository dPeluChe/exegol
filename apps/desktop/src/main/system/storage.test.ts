import { mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStorageReport, clearOldLogs, clearScreenshots, dirSize } from "./storage";

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
    const bytes = Object.fromEntries(report.rows.map((r) => [r.category, r.bytes]));
    expect(bytes).toEqual({
      models: 1000,
      scrollback: 350,
      screenshots: 200,
      logs: 80,
      database: 560,
      worktrees: 500,
      browser: 85,
      other: 10,
    });
    expect(report.totalBytes).toBe(2785);
    // Chromium lowercases partition folders; the project id keeps its case
    expect(report.browserPartitions).toEqual([
      { projectId: "ABC", projectName: "Proj", bytes: 85, cacheBytes: 80 },
    ]);
    expect(report.freeBytes).toBeGreaterThan(0);
  });

  it("clears screenshots and only the rotated logs", async () => {
    const { paths } = fixture();
    await clearScreenshots(paths.exegolDir);
    expect(readdirSync(join(paths.exegolDir, "screenshots"))).toEqual([]);
    expect(await clearOldLogs(paths.logDir)).toBe(2);
    expect(readdirSync(paths.logDir).sort()).toEqual(["exegol.log", "sidecar.log"]);
  });
});
