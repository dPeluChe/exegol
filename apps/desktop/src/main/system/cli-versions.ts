import { exec } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import {
  type CliInstallCopy,
  type CliInstallInfo,
  type CliUpdateStatus,
  isNewerVersion,
} from "@exegol/shared";
import { net } from "electron";
import { cliSetupFor, latestSourceOf, providerBinaries } from "../agents/cli-catalog";
import {
  classifyInstall,
  uninstallCommandFor,
  updateCommandFor,
} from "../agents/cli-install-method";
import { getProviderRegistry } from "../agents/registry";
import { _getFullPath, commandOnPath } from "../agents/spawn-env";
import { logger } from "../lib/logger";

const shellEnv = () => ({ ...process.env, PATH: _getFullPath() });

/** Best-effort `--version` of a binary, cached until the file changes (an update replaces it):
 *  every Doctor run started one process per installed CLI */
const versionCache = new Map<string, { mtimeMs: number; version: string | null }>();

export async function readBinaryVersion(binPath: string, fresh = false): Promise<string | null> {
  let mtimeMs = 0;
  let key = binPath;
  try {
    mtimeMs = statSync(binPath).mtimeMs;
    // A standalone update moves the link to a new release dir: the target is the identity
    key = realpathSync(binPath);
  } catch {
    return null;
  }
  const hit = versionCache.get(key);
  if (!fresh && hit && hit.mtimeMs === mtimeMs) return hit.version;
  const version = await runVersion(binPath);
  versionCache.set(key, { mtimeMs, version });
  return version;
}

function runVersion(binPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    exec(`"${binPath}" --version`, { env: shellEnv(), timeout: 3_000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = stdout.trim().match(/\d+\.\d+[.\w-]*/);
      resolve(m ? m[0] : null);
    });
  });
}

/** `where` ends lines with CRLF: a kept \r breaks stat and realpath */
export const parsePathHits = (stdout: string): string[] => [
  ...new Set(
    stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  ),
];

/** All PATH hits for a command (`which -a` / `where` both list every match). */
export function findAllOnPath(command: string): Promise<string[]> {
  const cmd = process.platform === "win32" ? `where "${command}"` : `which -a "${command}"`;
  return new Promise((resolve) =>
    exec(cmd, { env: shellEnv(), timeout: 3_000 }, (err, stdout) =>
      resolve(err ? [] : parsePathHits(stdout)),
    ),
  );
}

const LATEST_TTL_MS = 6 * 60 * 60 * 1000;
const latestCache = new Map<string, { at: number; version: string | null }>();

async function fetchLatest(cliType: string): Promise<string | null> {
  const source = latestSourceOf(cliType);
  if (!source) return null;
  const hit = latestCache.get(cliType);
  if (hit && Date.now() - hit.at < LATEST_TTL_MS) return hit.version;
  let version: string | null = null;
  try {
    const url =
      "npm" in source
        ? `https://registry.npmjs.org/${source.npm}/latest`
        : `https://pypi.org/pypi/${source.pypi}/json`;
    const res = await net.fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) {
      const body = (await res.json()) as { version?: string; info?: { version?: string } };
      version = ("npm" in source ? body.version : body.info?.version) ?? null;
    }
  } catch (err) {
    // Offline or blocked: no "update available" until the next try
    logger.info(
      `[CliVersions] Latest ${cliType} unavailable: ${err instanceof Error ? err.message : err}`,
    );
  }
  latestCache.set(cliType, { at: Date.now(), version });
  return version;
}

/** Providers whose binary is on PATH: the same stat-per-dir check spawn uses, so the launcher and
 *  a launch never disagree, and cheap enough to run on every listing (no process, no cache) */
export function installedProviderIds(): Set<string> {
  return new Set(
    getProviderRegistry()
      .list()
      .filter((p) => p.id !== "shell" && providerBinaries(p.command).some(commandOnPath))
      .map((p) => p.id),
  );
}

/** Every copy of a provider's CLI on PATH in PATH order (the first runs), each with how it was
 *  installed, its version and the commands that update or remove that copy. Two PATH entries
 *  reaching one file (a dir listed twice, a link to a link) are one copy */
export async function cliInstalls(cliType: string, fresh = false): Promise<CliInstallCopy[]> {
  const provider = getProviderRegistry().get(cliType);
  if (!provider || cliType === "shell") return [];
  const home = homedir();
  const seen = new Set<string>();
  const copies: { path: string; real: string }[] = [];
  for (const cmd of providerBinaries(provider.command)) {
    for (const path of await findAllOnPath(cmd)) {
      let real = path;
      try {
        real = realpathSync(path);
      } catch {
        continue; // dangling link: nothing runs from it
      }
      if (seen.has(real)) continue;
      seen.add(real);
      copies.push({ path, real });
    }
  }
  return Promise.all(
    copies.map(async ({ path, real }) => {
      const install = classifyInstall(cliType, path, real, home);
      return {
        path,
        ...install,
        version: await readBinaryVersion(path, fresh),
        updateCommand: updateCommandFor(cliType, install).command,
        uninstallCommand: uninstallCommandFor(install, path),
      };
    }),
  );
}

/** The copies of every installed built-in CLI (Settings > CLIs, the launcher badge) */
export async function allCliInstalls(): Promise<CliInstallInfo[]> {
  const ids = [...installedProviderIds()].filter((id) => getProviderRegistry().get(id)?.isBuiltin);
  const infos = await Promise.all(
    ids.map(async (cliType) => ({ cliType, copies: await cliInstalls(cliType) })),
  );
  return infos.filter((i) => i.copies.length > 0);
}

/** The installed version of a provider's CLI (the copy that runs) */
export async function installedCliVersion(cliType: string): Promise<string | null> {
  return (await installedCli(cliType)).version;
}

/** Only the copy that runs, its version read fresh, and when its binary changed. ctime, not
 *  mtime: npm extracts with the tarball's fixed 1985 mtime, the write still bumps ctime */
export async function runningCliBinary(
  cliType: string,
): Promise<{ version: string | null; changedAtMs: number } | null> {
  const provider = getProviderRegistry().get(cliType);
  if (!provider || cliType === "shell") return null;
  for (const cmd of providerBinaries(provider.command)) {
    for (const path of await findAllOnPath(cmd)) {
      let changedAtMs: number;
      try {
        changedAtMs = statSync(realpathSync(path)).ctimeMs;
      } catch {
        continue;
      }
      return { version: await readBinaryVersion(path, true), changedAtMs };
    }
  }
  return null;
}

/** The running copy's version, how it was installed and when its binary was written (an update
 *  rewrites it, or moves the symlink to a new versions/ file; stat follows the link) */
async function installedCli(cliType: string) {
  const [first] = await cliInstalls(cliType);
  if (!first) return { version: null, installedAt: null, copy: null };
  let installedAt: number | null = null;
  try {
    installedAt = statSync(first.path).mtimeMs;
  } catch {
    /* raced an update: no date this time */
  }
  return { version: first.version, installedAt, copy: first };
}

/** Installed vs newest release for these CLIs (the ones with live sessions) */
export async function cliUpdateStatus(cliTypes: string[]): Promise<CliUpdateStatus[]> {
  return Promise.all(
    [...new Set(cliTypes)].map(async (cliType) => {
      const [{ version: installed, installedAt, copy }, latest] = await Promise.all([
        installedCli(cliType),
        fetchLatest(cliType),
      ]);
      const update = copy
        ? updateCommandFor(cliType, copy)
        : { command: cliSetupFor(cliType)?.update ?? null, note: null };
      return {
        cliType,
        installed,
        installedAt,
        latest,
        updateAvailable: isNewerVersion(latest, installed),
        updateCommand: update.command,
        installMethod: copy?.method ?? null,
        updateNote: update.note,
      };
    }),
  );
}
