import { exec } from "node:child_process";
import { statSync } from "node:fs";
import { type CliUpdateStatus, isNewerVersion } from "@exegol/shared";
import { net } from "electron";
import { COMMAND_ALIASES, getProviderRegistry } from "../agents/registry";
import { _getFullPath } from "../agents/spawn-env";
import { logger } from "../lib/logger";

const shellEnv = () => ({ ...process.env, PATH: _getFullPath() });

// ─── Install and update per CLI (vendor docs, verified 2026-09-29) ─────────

/** The vendor's recommended macOS install, its update command and docs. Re-verify when a CLI
 *  changes how it ships: sources in docs/TASK_COMPLETED/2609.md (2026-09-29 entry) */
export const CLI_SETUP: Partial<
  Record<string, { install: string; update?: string; docs: string; deprecated?: string }>
> = {
  "claude-code": {
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    update: "claude update",
    docs: "https://code.claude.com/docs/en/setup",
  },
  codex: {
    install: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    update: "codex update",
    docs: "https://github.com/openai/codex",
  },
  gemini: {
    install: "npm install -g @google/gemini-cli",
    update: "npm install -g @google/gemini-cli@latest",
    docs: "https://geminicli.com/docs/get-started/installation/",
    deprecated: "Replaced upstream by Antigravity CLI (agy) on 2026-06-18",
  },
  agy: {
    install: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    update: "agy update",
    docs: "https://antigravity.google/docs/cli/install/",
  },
  devin: {
    install: "curl -fsSL https://cli.devin.ai/install.sh | bash",
    update: "devin update",
    docs: "https://docs.devin.ai/cli",
  },
  aider: {
    install: "python -m pip install aider-install && aider-install",
    update: "aider --upgrade",
    docs: "https://aider.chat/docs/install.html",
  },
  goose: {
    install:
      "curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash",
    update: "goose update",
    docs: "https://goose-docs.ai/docs/getting-started/installation/",
  },
  opencode: {
    install: "curl -fsSL https://opencode.ai/install | bash",
    update: "opencode upgrade",
    docs: "https://opencode.ai/docs/",
  },
  amp: {
    install: "curl -fsSL https://ampcode.com/install.sh | bash",
    update: "amp update",
    docs: "https://ampcode.com/docs/cli",
  },
  kiro: {
    install: "curl -fsSL https://cli.kiro.dev/install | bash",
    update: "kiro-cli update",
    docs: "https://kiro.dev/docs/cli/installation/",
  },
  kilocode: {
    install: "npm install -g @kilocode/cli",
    update: "kilo upgrade",
    docs: "https://kilo.ai/docs/code-with-ai/platforms/cli",
  },
  crush: {
    install: "brew install charmbracelet/tap/crush",
    update: "brew upgrade charmbracelet/tap/crush",
    docs: "https://github.com/charmbracelet/crush",
  },
  "factory-droid": {
    install: "curl -fsSL https://app.factory.ai/cli | sh",
    update: "droid update",
    docs: "https://docs.factory.ai/droid-cli/quickstart",
  },
};

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

/** Where a CLI's newest release is published. Only sources whose numbers match `--version`;
 *  agy, devin, droid, kiro and goose have none we can read, so they only get "restart to update" */
const LATEST_SOURCES: Partial<Record<string, { npm: string } | { pypi: string }>> = {
  "claude-code": { npm: "@anthropic-ai/claude-code" },
  codex: { npm: "@openai/codex" },
  gemini: { npm: "@google/gemini-cli" },
  opencode: { npm: "opencode-ai" },
  amp: { npm: "@sourcegraph/amp" },
  kilocode: { npm: "@kilocode/cli" },
  crush: { npm: "@charmland/crush" },
  aider: { pypi: "aider-chat" },
};

const LATEST_TTL_MS = 6 * 60 * 60 * 1000;
const latestCache = new Map<string, { at: number; version: string | null }>();

async function fetchLatest(cliType: string): Promise<string | null> {
  const source = LATEST_SOURCES[cliType];
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

const INSTALLED_TTL_MS = 30_000;
let installedCache: { at: number; ids: Promise<Set<string>> } | null = null;

/** Providers whose command (or a renamed binary) is on PATH. Cached 30s: every launcher list
 *  asks, and each check is a `which` per CLI. `fresh` re-checks after an install */
export function installedProviderIds(fresh = false): Promise<Set<string>> {
  if (!fresh && installedCache && Date.now() - installedCache.at < INSTALLED_TTL_MS) {
    return installedCache.ids;
  }
  const ids = Promise.all(
    getProviderRegistry()
      .list()
      .filter((p) => p.id !== "shell")
      .map(async (p) => {
        for (const cmd of [p.command, ...(COMMAND_ALIASES[p.command] ?? [])]) {
          if ((await findAllOnPath(cmd)).length > 0) return p.id;
        }
        return null;
      }),
  ).then((found) => new Set(found.filter((id): id is string => id !== null)));
  installedCache = { at: Date.now(), ids };
  return ids;
}

/** The installed version of a provider's CLI (its first PATH hit, renamed binaries included) */
export async function installedCliVersion(cliType: string): Promise<string | null> {
  const provider = getProviderRegistry().get(cliType);
  if (!provider || cliType === "shell") return null;
  for (const cmd of [provider.command, ...(COMMAND_ALIASES[provider.command] ?? [])]) {
    const [path] = await findAllOnPath(cmd);
    if (path) return readBinaryVersion(path);
  }
  return null;
}

/** Installed vs newest release for these CLIs (the ones with live sessions) */
export async function cliUpdateStatus(cliTypes: string[]): Promise<CliUpdateStatus[]> {
  return Promise.all(
    [...new Set(cliTypes)].map(async (cliType) => {
      const [installed, latest] = await Promise.all([
        installedCliVersion(cliType),
        fetchLatest(cliType),
      ]);
      return {
        cliType,
        installed,
        latest,
        updateAvailable: isNewerVersion(latest, installed),
        updateCommand: CLI_SETUP[cliType]?.update ?? null,
      };
    }),
  );
}
