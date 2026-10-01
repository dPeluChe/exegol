import { exec } from "node:child_process";
import { statSync } from "node:fs";
import { type CliUpdateStatus, isNewerVersion } from "@exegol/shared";
import { net } from "electron";
import { COMMAND_ALIASES, getProviderRegistry } from "../agents/registry";
import { _getFullPath, commandOnPath } from "../agents/spawn-env";
import { logger } from "../lib/logger";

const shellEnv = () => ({ ...process.env, PATH: _getFullPath() });

// ─── Install and update per CLI (vendor docs, verified 2026-09-29) ─────────

/** A command for every OS, or per OS; a missing OS has no native install (the docs say how) */
type PerOs = string | { unix?: string; mac?: string; linux?: string; win?: string };

interface CliSetup {
  install: PerOs;
  /** Absent: the CLI has no update command, so re-running its installer updates it */
  update?: PerOs;
  docs: string;
  deprecated?: string;
}

const CURL = (url: string, sh = "bash") => `curl -fsSL ${url} | ${sh}`;
const IRM = (url: string) => `irm ${url} | iex`;

/** Each vendor's recommended install and update per OS, from their install docs (2026-10-01,
 *  sources in docs/TASK_COMPLETED/2610.md). Re-check when a CLI changes how it ships */
export const CLI_SETUP: Partial<Record<string, CliSetup>> = {
  "claude-code": {
    install: {
      unix: CURL("https://claude.ai/install.sh"),
      win: IRM("https://claude.ai/install.ps1"),
    },
    update: "claude update",
    docs: "https://code.claude.com/docs/en/setup",
  },
  codex: {
    install: {
      unix: CURL("https://chatgpt.com/codex/install.sh", "sh"),
      win: `powershell -ExecutionPolicy ByPass -c "${IRM("https://chatgpt.com/codex/install.ps1")}"`,
    },
    docs: "https://github.com/openai/codex",
  },
  gemini: {
    install: "npm install -g @google/gemini-cli",
    update: "npm install -g @google/gemini-cli@latest",
    docs: "https://geminicli.com/docs/get-started/installation/",
    deprecated: "Replaced upstream by Antigravity CLI (agy) on 2026-06-18",
  },
  agy: {
    install: {
      unix: CURL("https://antigravity.google/cli/install.sh"),
      win: IRM("https://antigravity.google/cli/install.ps1"),
    },
    docs: "https://antigravity.google/docs/cli/install/",
  },
  devin: {
    install: {
      unix: CURL("https://cli.devin.ai/install.sh"),
      win: IRM("https://static.devin.ai/cli/setup.ps1"),
    },
    docs: "https://docs.devin.ai/cli",
  },
  aider: {
    install: {
      unix: "curl -LsSf https://aider.chat/install.sh | sh",
      win: `powershell -ExecutionPolicy ByPass -c "${IRM("https://aider.chat/install.ps1")}"`,
    },
    update: "aider --upgrade",
    docs: "https://aider.chat/docs/install.html",
  },
  goose: {
    install: {
      unix: CURL("https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh"),
      win: 'Invoke-WebRequest -Uri "https://raw.githubusercontent.com/aaif-goose/goose/main/download_cli.ps1" -OutFile "download_cli.ps1"; .\\download_cli.ps1',
    },
    update: "goose update",
    docs: "https://goose-docs.ai/docs/getting-started/installation/",
  },
  opencode: {
    install: { unix: CURL("https://opencode.ai/install"), win: "scoop install opencode" },
    update: "opencode upgrade",
    docs: "https://opencode.ai/docs/",
  },
  // Windows only through WSL
  amp: {
    install: { unix: CURL("https://ampcode.com/install.sh") },
    update: "amp update",
    docs: "https://ampcode.com/docs/cli",
  },
  kiro: {
    install: {
      mac: CURL("https://cli.kiro.dev/install"),
      linux:
        "curl --proto '=https' --tlsv1.2 -sSf 'https://desktop-release.q.us-east-1.amazonaws.com/latest/kirocli-x86_64-linux.zip' -o kirocli.zip && unzip kirocli.zip && ./kirocli/install.sh",
      win: IRM("'https://cli.kiro.dev/install.ps1'"),
    },
    update: "kiro-cli update",
    docs: "https://kiro.dev/docs/cli/installation/",
  },
  kilocode: {
    install: "npm install -g @kilocode/cli",
    update: "kilo upgrade",
    docs: "https://kilo.ai/docs/code-with-ai/platforms/cli",
  },
  // No self-update: the package manager it came from updates it
  crush: {
    install: {
      mac: "brew install charmbracelet/tap/crush",
      linux: "npm install -g @charmland/crush",
      win: "winget install charmbracelet.crush",
    },
    update: {
      mac: "brew upgrade charmbracelet/tap/crush",
      linux: "npm install -g @charmland/crush@latest",
      win: "winget upgrade charmbracelet.crush",
    },
    docs: "https://github.com/charmbracelet/crush",
  },
  "factory-droid": {
    install: {
      unix: CURL("https://app.factory.ai/cli", "sh"),
      win: IRM("https://app.factory.ai/cli/windows"),
    },
    update: "droid update",
    docs: "https://docs.factory.ai/droid-cli/quickstart",
  },
};

function forOs(cmd: PerOs | undefined, platform: NodeJS.Platform): string | null {
  if (cmd === undefined) return null;
  if (typeof cmd === "string") return cmd;
  if (platform === "win32") return cmd.win ?? null;
  if (platform === "darwin") return cmd.mac ?? cmd.unix ?? null;
  return cmd.linux ?? cmd.unix ?? null;
}

/** A CLI's install and update commands for this OS (null: no native way, see `docs`) */
export function cliSetupFor(cliType: string, platform: NodeJS.Platform = process.platform) {
  const setup = CLI_SETUP[cliType];
  if (!setup) return null;
  const install = forOs(setup.install, platform);
  return {
    install,
    update: forOs(setup.update, platform) ?? install,
    docs: setup.docs,
    deprecated: setup.deprecated,
  };
}

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

/** A provider's binary and the names it moved to (kilocode → kilo), in lookup order */
export function providerBinaries(command: string): string[] {
  return [command, ...(COMMAND_ALIASES[command] ?? [])];
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
