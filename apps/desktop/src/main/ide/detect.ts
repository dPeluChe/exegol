import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { IdeInfo } from "@exegol/shared";
import { findOnPath } from "../agents/spawn-env";
import { mapWithConcurrency } from "../lib/concurrency";
import {
  IDE_LAUNCH,
  type IdeLaunch,
  type LineStyle,
  matchBundles,
  matchDesktopFiles,
  parseDesktopExec,
  plistBundleId,
} from "./catalog";

const execFileAsync = promisify(execFile);

type IdeId = IdeInfo["id"];

/** What runs to open a file: `argv` then the target; `line` null when it cannot take a line */
export interface IdeLauncher {
  argv: string[];
  line: LineStyle | null;
}

const TTL_MS = 10 * 60_000;
let cache: { at: number; result: Promise<Map<IdeId, IdeLauncher>> } | null = null;

/** Installed IDEs and how to launch each, cached 10 min (app scan + PATH stats, no hot path) */
export function detectIdes(fresh = false): Promise<Map<IdeId, IdeLauncher>> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.result;
  const result = scan().catch(() => new Map<IdeId, IdeLauncher>());
  cache = { at: Date.now(), result };
  return result;
}

async function scan(): Promise<Map<IdeId, IdeLauncher>> {
  const home = homedir();
  const apps = process.platform === "darwin" ? matchBundles(await macApps(home)) : new Map();
  const desktop =
    process.platform === "linux" ? await linuxDesktopLaunchers(home) : new Map<IdeId, string[]>();
  const found = new Map<IdeId, IdeLauncher>();
  for (const [id, launch] of Object.entries(IDE_LAUNCH) as [IdeId, IdeLaunch][]) {
    const launcher = cliLauncher(launch, home) ?? appLauncher(launch, apps.get(id));
    const exec = desktop.get(id);
    if (launcher) found.set(id, launcher);
    else if (exec) found.set(id, { argv: exec, line: launch.line });
  }
  return found;
}

function cliLauncher(launch: IdeLaunch, home: string): IdeLauncher | null {
  for (const command of launch.commands) {
    const onPath = findOnPath(command);
    const path =
      onPath ??
      launch.extraDirs?.map((d) => join(home, d, command)).find((p) => existsSync(p)) ??
      null;
    if (path) return { argv: [path], line: launch.line };
  }
  return null;
}

function appLauncher(launch: IdeLaunch, app: string | undefined): IdeLauncher | null {
  if (!app) return null;
  const cli = launch.macBundleCli && join(app, launch.macBundleCli);
  if (cli && existsSync(cli)) return { argv: [cli], line: launch.line };
  // JetBrains documents `open -na <app> --args --line N file` for a Mac without its script
  if (launch.line === "jetbrains")
    return { argv: ["open", "-na", app, "--args"], line: "jetbrains" };
  return { argv: ["open", "-a", app], line: null };
}

async function macApps(home: string): Promise<{ path: string; bundleId: string }[]> {
  const dirs = [
    "/Applications",
    join(home, "Applications"),
    join(home, "Applications/JetBrains Toolbox"),
  ];
  const paths = (
    await Promise.all(
      dirs.map((d) =>
        readdir(d)
          .then((names) =>
            names
              .filter((n) => n.endsWith(".app"))
              .sort()
              .map((n) => join(d, n)),
          )
          .catch(() => [] as string[]),
      ),
    )
  ).flat();
  const ids = await mapWithConcurrency(paths, 8, bundleIdOf);
  return paths.flatMap((path, i) => {
    const bundleId = ids[i];
    return bundleId ? [{ path, bundleId }] : [];
  });
}

async function bundleIdOf(app: string): Promise<string | null> {
  const plist = join(app, "Contents/Info.plist");
  const text = await readFile(plist, "utf8").catch(() => null);
  if (!text) return null;
  if (!text.startsWith("bplist")) return plistBundleId(text);
  const { stdout } = await execFileAsync(
    "plutil",
    ["-extract", "CFBundleIdentifier", "raw", plist],
    { timeout: 5_000 },
  ).catch(() => ({ stdout: "" }));
  return stdout.trim() || null;
}

async function linuxDesktopLaunchers(home: string): Promise<Map<IdeId, string[]>> {
  const dirs = [
    join(home, ".local/share/applications"),
    "/usr/share/applications",
    "/usr/local/share/applications",
    join(home, ".local/share/flatpak/exports/share/applications"),
    "/var/lib/flatpak/exports/share/applications",
    "/var/lib/snapd/desktop/applications",
  ];
  const files = (
    await Promise.all(
      dirs.map((d) =>
        readdir(d)
          .then((names) => names.map((n) => join(d, n)))
          .catch(() => [] as string[]),
      ),
    )
  ).flat();
  const byName = new Map(files.map((f) => [basename(f), f]));
  const out = new Map<IdeId, string[]>();
  for (const [id, name] of matchDesktopFiles([...byName.keys()])) {
    const file = byName.get(name);
    const argv = file ? parseDesktopExec(await readFile(file, "utf8").catch(() => "")) : null;
    if (argv) out.set(id, argv);
  }
  return out;
}
