import { exec } from "node:child_process";
import { statSync } from "node:fs";
import { type CliUpdateStatus, isNewerVersion } from "@exegol/shared";
import { net } from "electron";
import { cliSetupFor, latestSourceOf, providerBinaries } from "../agents/cli-catalog";
import { getProviderRegistry } from "../agents/registry";
import { _getFullPath, commandOnPath } from "../agents/spawn-env";
import { logger } from "../lib/logger";

const shellEnv = () => ({ ...process.env, PATH: _getFullPath() });

/** Best-effort `--version` of a binary, cached until the file changes (an update replaces it):
 *  every Doctor run started one process per installed CLI */
const versionCache = new Map<string, { mtimeMs: number; version: string | null }>();

export async function readBinaryVersion(binPath: string): Promise<string | null> {
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(binPath).mtimeMs;
  } catch {
    return null;
  }
  const hit = versionCache.get(binPath);
  if (hit && hit.mtimeMs === mtimeMs) return hit.version;
  const version = await runVersion(binPath);
  versionCache.set(binPath, { mtimeMs, version });
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

/** All PATH hits for a command (`which -a` / `where` both list every match). */
export function findAllOnPath(command: string): Promise<string[]> {
  const cmd = process.platform === "win32" ? `where "${command}"` : `which -a "${command}"`;
  return new Promise((resolve) =>
    exec(cmd, { env: shellEnv(), timeout: 3_000 }, (err, stdout) =>
      resolve(err ? [] : [...new Set(stdout.trim().split("\n").filter(Boolean))]),
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

/** The installed version of a provider's CLI (its first PATH hit, renamed binaries included) */
export async function installedCliVersion(cliType: string): Promise<string | null> {
  return (await installedCli(cliType)).version;
}

/** The installed CLI's version and when its binary was written (an update rewrites it, or moves
 *  the symlink to a new versions/ file; stat follows the link) */
async function installedCli(
  cliType: string,
): Promise<{ version: string | null; installedAt: number | null }> {
  const provider = getProviderRegistry().get(cliType);
  if (!provider || cliType === "shell") return { version: null, installedAt: null };
  for (const cmd of providerBinaries(provider.command)) {
    const [path] = await findAllOnPath(cmd);
    if (!path) continue;
    let installedAt: number | null = null;
    try {
      installedAt = statSync(path).mtimeMs;
    } catch {
      /* raced an update: no date this time */
    }
    return { version: await readBinaryVersion(path), installedAt };
  }
  return { version: null, installedAt: null };
}

/** Installed vs newest release for these CLIs (the ones with live sessions) */
export async function cliUpdateStatus(cliTypes: string[]): Promise<CliUpdateStatus[]> {
  return Promise.all(
    [...new Set(cliTypes)].map(async (cliType) => {
      const [{ version: installed, installedAt }, latest] = await Promise.all([
        installedCli(cliType),
        fetchLatest(cliType),
      ]);
      return {
        cliType,
        installed,
        installedAt,
        latest,
        updateAvailable: isNewerVersion(latest, installed),
        updateCommand: cliSetupFor(cliType)?.update ?? null,
      };
    }),
  );
}
