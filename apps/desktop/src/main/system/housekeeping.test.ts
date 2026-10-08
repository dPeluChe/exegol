import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentFileTargets, sweepOrphanAgentFiles } from "./housekeeping";

const LIVE = "live".padEnd(21, "0");
const ARCHIVED = "archived".padEnd(21, "1");
const GONE = "gone".padEnd(21, "2");
const NOW = Date.now();
const OLD = (NOW - 3 * 24 * 60 * 60 * 1000) / 1000;

let root = "";
afterEach(() => rmSync(root, { recursive: true, force: true }));

function file(path: string, old = true) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "x".repeat(10));
  if (old) utimesSync(path, OLD, OLD);
  return path;
}

function fixture() {
  root = mkdtempSync(join(tmpdir(), "exegol-housekeeping-"));
  const paths = { exegolDir: join(root, "exegol"), userData: join(root, "userData") };
  return { paths, targets: agentFileTargets(paths) };
}

const known = () => new Set([LIVE, ARCHIVED]);

describe("sweepOrphanAgentFiles", () => {
  it("removes only old files of ids missing from the DB", async () => {
    const { paths, targets } = fixture();
    const keep = [
      file(join(paths.exegolDir, "hooks", `${LIVE}.json`)),
      file(join(paths.exegolDir, "mcp", `${ARCHIVED}.json`)),
      file(join(paths.userData, "scrollback", `${LIVE}.serialized`)),
      file(join(paths.exegolDir, "hooks", "notify.sh")),
      file(join(paths.exegolDir, "hooks", `${GONE}.sh`)),
      file(join(paths.exegolDir, "mcp", "short.json")),
      file(join(paths.exegolDir, "hooks", `${"z".repeat(21)}.json`), false),
    ];
    const gone = [
      file(join(paths.exegolDir, "hooks", `${GONE}.json`)),
      file(join(paths.exegolDir, "mcp", `${GONE}.json`)),
      file(join(paths.exegolDir, "model-settings", `${GONE}.json`)),
      file(join(paths.userData, "scrollback", `${GONE}.log`)),
      file(join(paths.userData, "scrollback", `${GONE}.serialized`)),
    ];
    const result = await sweepOrphanAgentFiles(targets, known, NOW);
    expect(result.files).toBe(gone.length);
    expect(result.bytes).toBe(gone.length * 10);
    for (const p of gone) expect(existsSync(p)).toBe(false);
    for (const p of keep) expect(existsSync(p)).toBe(true);
  });

  it("never follows symlinks, for the folder or a file", async () => {
    const { paths, targets } = fixture();
    const outside = file(join(root, "outside", `${GONE}.json`));
    mkdirSync(paths.exegolDir, { recursive: true });
    symlinkSync(join(root, "outside"), join(paths.exegolDir, "hooks"));
    mkdirSync(join(paths.exegolDir, "mcp"), { recursive: true });
    symlinkSync(outside, join(paths.exegolDir, "mcp", `${GONE}.json`));
    const result = await sweepOrphanAgentFiles(targets, known, NOW);
    expect(result.files).toBe(0);
    expect(existsSync(outside)).toBe(true);
  });

  it("does nothing when the agents table is empty", async () => {
    const { paths, targets } = fixture();
    const p = file(join(paths.exegolDir, "hooks", `${GONE}.json`));
    const result = await sweepOrphanAgentFiles(targets, () => new Set(), NOW);
    expect(result.files).toBe(0);
    expect(existsSync(p)).toBe(true);
  });

  it("reads the ids only after listing, and not at all with nothing to remove", async () => {
    const { targets } = fixture();
    let reads = 0;
    await sweepOrphanAgentFiles(targets, () => {
      reads++;
      return known();
    });
    expect(reads).toBe(0);
  });
});
