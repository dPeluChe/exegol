// Post-build cleanup. Dry run unless --apply. Every target is listed in docs/GUIDES/RELEASE.md.
// Always exits 0 (it runs as the postpackage step): a failure removes nothing more, never fails a build.
//   bun run clean:build                    report what would go
//   bun run clean:build -- --apply         remove it (repo targets + old test temp dirs)
//   --repo-only  skip the test temp dirs    --keep N  release folders kept (2)    --days N  age (14)
//   --root DIR   another checkout of this repo (default: the one holding this script)
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  DAY_MS,
  type Entry,
  parseVersion,
  planDist,
  planIncremental,
  planTestTmp,
  planTurbo,
} from "./clean-build-plan";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const repoOnly = args.includes("--repo-only");
const keep = numberArg("--keep", 2);
const cutoff = Date.now() - numberArg("--days", 14) * DAY_MS;

const rootArg = args.indexOf("--root");
const ROOT = resolve(rootArg >= 0 ? (args[rootArg + 1] ?? "") : join(__dirname, "../../.."));
const DESKTOP = join(ROOT, "apps/desktop");

function numberArg(flag: string, fallback: number): number {
  const i = args.indexOf(flag);
  const n = i >= 0 ? Number(args[i + 1]) : Number.NaN;
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function entries(dir: string, kind: "dir" | "file"): Entry[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const info = lstatSync(join(dir, name), { throwIfNoEntry: false });
    if (!info || (kind === "dir" ? !info.isDirectory() : !info.isFile())) return [];
    return [{ name, mtimeMs: info.mtimeMs }];
  });
}

function bytes(path: string): number {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info || info.isSymbolicLink()) return 0;
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const name of readdirSync(path)) total += bytes(join(path, name));
  return total;
}

function human(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** stdout, or null when the command is missing, times out (10 s) or exits outside `okCodes` */
function run(cmd: string, cmdArgs: string[], okCodes = [0]): string | null {
  const r = spawnSync(cmd, cmdArgs, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
  });
  return r.error || r.status === null || !okCodes.includes(r.status) ? null : r.stdout;
}

/** lsof exits 1 when nothing is open; false only when it ran and listed nothing */
function inUse(dir: string): boolean {
  if (platform() === "win32") return true;
  const out = run("lsof", ["+D", dir], [0, 1]);
  return out === null || out.trim() !== "";
}

interface Group {
  title: string;
  paths: string[];
  skipped: { path: string; reason: string }[];
}

function distGroup(current: string): Group {
  const dist = join(DESKTOP, "dist");
  const group: Group = {
    title: `dist (keeps the newest ${keep} and the current ${current})`,
    paths: [],
    skipped: [],
  };
  const names = planDist(entries(dist, "dir"), current, keep);
  if (names.length === 0) return group;
  // Mounted, running (Exegol.app opened from dist) or with an open file: skipped, never detached.
  // Windows has no ps/lsof here, so every folder is skipped there
  const processes = run("ps", ["-axww", "-o", "command="]);
  const mounts = platform() === "darwin" ? run("hdiutil", ["info"]) : "";
  for (const name of names) {
    const path = join(dist, name);
    const inside = `${path}/`;
    if (processes === null || mounts === null) {
      group.skipped.push({ path, reason: "could not check mounts/processes" });
    } else if (mounts.split("\n").some((l) => /^image-path\s*:/.test(l) && l.includes(inside))) {
      group.skipped.push({ path, reason: "DMG mounted" });
    } else if (processes.includes(inside) || inUse(path)) {
      group.skipped.push({ path, reason: "in use, or lsof could not check" });
    } else {
      group.paths.push(path);
    }
  }
  return group;
}

function turboGroup(): Group {
  const cache = join(ROOT, ".turbo/cache");
  const paths = planTurbo(entries(cache, "file"), cutoff).map((n) => join(cache, n));
  return { title: "turbo cache entries (older than --days)", paths, skipped: [] };
}

function incrementalGroup(): Group {
  const target = join(ROOT, "packages/core-rust/target");
  const group: Group = { title: "rust incremental (older than --days)", paths: [], skipped: [] };
  const triples = entries(target, "dir").filter((e) =>
    /^[a-z0-9_]+(-[a-z0-9_]+){2,3}$/.test(e.name),
  );
  const dirs = ["", ...triples.map((t) => t.name)].flatMap((base) =>
    ["debug", "release"].map((profile) => join(target, base, profile, "incremental")),
  );
  const found = dirs.flatMap((dir) =>
    planIncremental(entries(dir, "dir"), cutoff).map((n) => join(dir, n)),
  );
  if (found.length === 0) return group;
  const processes = run("ps", ["-axww", "-o", "comm="]);
  if (processes === null || /(^|\/)(cargo|rustc)$/m.test(processes)) {
    group.skipped.push({ path: target, reason: "cargo is running (or could not check)" });
  } else {
    group.paths = found;
  }
  return group;
}

function testTmpGroup(): Group {
  const tmp = tmpdir();
  // A day, not --days: macOS purges $TMPDIR after 3 idle days, and no test run lasts a day
  const paths = planTestTmp(entries(tmp, "dir"), Date.now() - DAY_MS).map((n) => join(tmp, n));
  return { title: "test temp dirs in $TMPDIR (older than a day)", paths, skipped: [] };
}

function show(path: string): string {
  if (path.startsWith(`${ROOT}/`)) return relative(ROOT, path);
  if (path.startsWith(tmpdir())) return `$TMPDIR/${relative(tmpdir(), path)}`;
  return path;
}

function currentVersion(): string | null {
  try {
    const version = JSON.parse(readFileSync(join(DESKTOP, "package.json"), "utf-8")).version;
    return typeof version === "string" && parseVersion(version) ? version : null;
  } catch {
    return null;
  }
}

function main(): void {
  const current = existsSync(join(DESKTOP, "electron-builder.ts")) ? currentVersion() : null;
  if (!current) {
    console.log(`clean:build: no Exegol repo with a valid version at ${ROOT}, nothing removed`);
    return;
  }
  console.log(`clean:build ${apply ? "(apply)" : "(dry run: nothing is removed, pass --apply)"}`);
  const groups = [distGroup(current), turboGroup(), incrementalGroup()];
  if (!repoOnly) groups.push(testTmpGroup());
  let total = 0;
  let count = 0;
  for (const group of groups) {
    console.log(`\n${group.title}`);
    if (group.paths.length === 0 && group.skipped.length === 0) console.log("  nothing to do");
    for (const s of group.skipped) console.log(`  skip ${show(s.path)} (${s.reason})`);
    let groupBytes = 0;
    for (const path of group.paths) {
      let size: number;
      try {
        const info = lstatSync(path, { throwIfNoEntry: false });
        if (!info || info.isSymbolicLink()) continue;
        size = bytes(path);
        if (apply) rmSync(path, { recursive: true, force: true });
      } catch (err) {
        console.log(`  skip ${show(path)} (error: ${err instanceof Error ? err.message : err})`);
        continue;
      }
      groupBytes += size;
      count++;
      // Thousands of temp dirs: one line each would drown the rest
      if (apply || group.paths.length <= 25) {
        console.log(`  ${apply ? "removed" : "would remove"} ${show(path)} ${human(size)}`);
      }
    }
    if (!apply && group.paths.length > 25) {
      console.log(`  ${apply ? "removed" : "would remove"} ${group.paths.length} entries`);
    }
    if (groupBytes > 0) console.log(`  subtotal ${human(groupBytes)}`);
    total += groupBytes;
  }
  console.log(`\n${apply ? "Freed" : "Would free"} ${human(total)} in ${count} item(s)`);

  const caches =
    platform() === "darwin"
      ? ["Library/Caches/electron", "Library/Caches/electron-builder"]
      : [".cache/electron", ".cache/electron-builder"];
  console.log("\nInfo only, never removed (shared with other Electron projects):");
  for (const c of caches) {
    const kb = Number.parseInt(run("du", ["-sk", join(homedir(), c)])?.split(/\s/)[0] ?? "", 10);
    if (!Number.isNaN(kb)) console.log(`  ~/${c} ${human(kb * 1024)}`);
  }
  console.log(
    "~/.exegol and the app data folder are swept by the app itself (orphaned agent files).",
  );
}

try {
  main();
} catch (err) {
  console.log(`clean:build stopped: ${err instanceof Error ? err.message : err}`);
}
