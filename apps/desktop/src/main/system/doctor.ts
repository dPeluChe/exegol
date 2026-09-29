import { exec } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DoctorCheck, DoctorReport, DoctorStatus } from "@exegol/shared";
import { safeStorage } from "electron";
import type Database from "libsql";
import { COMMAND_ALIASES, getProviderRegistry } from "../agents/registry";
import { _getFullPath, coreRust } from "../agents/spawn-env";
import { getAppSettings } from "../db/queries/settings";
import { checkOllamaStatus } from "../indexer/ollama-client";
import { getApiKey } from "../security/keystore";

const execAsync = promisify(exec);

// Packaged macOS Electron inherits launchd's stripped PATH — Homebrew CLIs
// (claude, gh, ollama...) are invisible to it. _getFullPath resolves the
// user's login-shell PATH exactly like agent spawns do; without this the
// onboarding wizard reports every installed CLI as missing on first run.
// Lazy: resolving it at import ran a login shell before the window existed
const shellEnv = () => ({ ...process.env, PATH: _getFullPath() });

// ─── Types ──────────────────────────────────────────────────────────────────

export type { DoctorCategory, DoctorCheck, DoctorReport, DoctorStatus } from "@exegol/shared";

// ─── Install and update per CLI (vendor docs, verified 2026-09-29) ─────────

/** The vendor's recommended macOS install, its update command and docs. Re-verify when a CLI
 *  changes how it ships: sources in docs/TASK_COMPLETED/2609.md (2026-09-29 entry) */
const CLI_SETUP: Partial<
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
    update: "gemini update",
    docs: "https://geminicli.com/docs/get-started/installation/",
    deprecated: "Replaced upstream by Antigravity CLI (agy) on 2026-06-18",
  },
  // The install script also upgrades (no update command)
  agy: {
    install: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
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

// ─── Individual checks ──────────────────────────────────────────────────────

function checkCommandAvailable(command: string): Promise<boolean> {
  const cmd = process.platform === "win32" ? `where "${command}"` : `which "${command}"`;
  return new Promise((resolve) =>
    exec(cmd, { env: shellEnv(), timeout: 3_000 }, (err) => resolve(!err)),
  );
}

/** All PATH hits for a command (`which -a` / `where` both list every match). */
function findAllOnPath(command: string): Promise<string[]> {
  const cmd = process.platform === "win32" ? `where "${command}"` : `which -a "${command}"`;
  return new Promise((resolve) =>
    exec(cmd, { env: shellEnv(), timeout: 3_000 }, (err, stdout) =>
      resolve(err ? [] : [...new Set(stdout.trim().split("\n").filter(Boolean))]),
    ),
  );
}

async function checkGitVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git --version", { timeout: 3_000, env: shellEnv() });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Best-effort `--version` of a binary, cached until the file changes (an update replaces it):
 *  every Doctor run started one process per installed CLI */
const versionCache = new Map<string, { mtimeMs: number; version: string | null }>();

async function readBinaryVersion(binPath: string): Promise<string | null> {
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

function checkPtySidecar(): DoctorCheck {
  const pidFilePath = join(homedir(), ".exegol", "pty-sidecar.pid");
  try {
    if (!existsSync(pidFilePath)) {
      return {
        id: "pty-sidecar",
        label: "PTY sidecar",
        status: "ok",
        detail: "Not running — starts on demand with the first terminal",
        category: "system",
      };
    }
    // Pid file is JSON: { pid, token, version, sock } (pty-sidecar-protocol.ts)
    const meta = JSON.parse(readFileSync(pidFilePath, "utf8")) as { pid: number; version?: string };
    process.kill(meta.pid, 0);
    return {
      id: "pty-sidecar",
      label: "PTY sidecar",
      status: "ok",
      detail: `Alive (pid ${meta.pid}${meta.version ? `, v${meta.version}` : ""}) — terminals survive app restarts`,
      category: "system",
    };
  } catch {
    return {
      id: "pty-sidecar",
      label: "PTY sidecar",
      status: "warn",
      detail: "Stale pid file — sidecar process is dead; next terminal spawn will restart it",
      category: "system",
    };
  }
}

function checkMcpSocket(): Promise<DoctorCheck> {
  const sockPath = join(homedir(), ".exegol", "mcp-server.sock");
  if (!existsSync(sockPath)) {
    return Promise.resolve({
      id: "exegol-mcp",
      label: "Exegol MCP server",
      status: "ok",
      detail: "Not running — starts with the first agent spawn",
      category: "system",
    });
  }
  return new Promise((resolve) => {
    const sock = createConnection(sockPath);
    const done = (status: DoctorStatus, detail: string) => {
      sock.destroy();
      resolve({ id: "exegol-mcp", label: "Exegol MCP server", status, detail, category: "system" });
    };
    sock.setTimeout(500);
    sock.on("connect", () => done("ok", "Listening — agents can reach memory/knowledge tools"));
    sock.on("timeout", () => done("warn", "Socket file present but not answering"));
    sock.on("error", () =>
      done("warn", "Stale socket file — server not listening; respawns with the next agent"),
    );
  });
}

async function runCliDetection(): Promise<DoctorCheck[]> {
  const providers = getProviderRegistry()
    .listBuiltin()
    .filter((p) => p.id !== "shell");

  return Promise.all(
    providers.map(async (provider) => {
      // A renamed binary (kilocode → kilo) counts as installed under its new name
      let paths: string[] = [];
      let found = provider.command;
      for (const cmd of [provider.command, ...(COMMAND_ALIASES[provider.command] ?? [])]) {
        paths = await findAllOnPath(cmd);
        found = cmd;
        if (paths.length > 0) break;
      }
      const installed = paths.length > 0;
      // Duplicate installs (e.g. Homebrew + bun copies of codex) cause
      // self-update loops: the update lands in one path while the other
      // wins PATH resolution — live incident 2026-07-09.
      const duplicated = paths.length > 1;
      let detail: string;
      if (duplicated) {
        const versions = await Promise.all(paths.map(readBinaryVersion));
        const labeled = paths.map((p, i) => (versions[i] ? `${p} (v${versions[i]})` : p));
        const first = labeled[0];
        const rest = labeled.slice(1).join(" · ");
        detail = `Multiple installs — PATH resolves to ${first}; updates may land in the losing copy: ${rest}`;
      } else if (installed) {
        // The version answers "is mine current?" before launching it
        const version = await readBinaryVersion(paths[0] ?? "");
        detail = version ? `v${version} · ${paths[0]}` : `Found '${found}' on PATH`;
      } else {
        detail = `'${provider.command}' not found on PATH`;
      }
      const setup = CLI_SETUP[provider.id];
      if (setup?.deprecated) detail = `${detail} · ${setup.deprecated}`;
      return {
        id: `cli:${provider.id}`,
        label: provider.name,
        status: installed ? (duplicated ? "warn" : "ok") : "warn",
        detail,
        actionUrl: installed ? undefined : setup?.docs,
        installCommand: installed ? undefined : setup?.install,
        updateCommand: installed ? (setup?.update ?? setup?.install) : undefined,
        category: "agents",
      } satisfies DoctorCheck;
    }),
  );
}

/** Worktrees on disk whose agent is gone/terminal and untouched for N days. */
function checkStaleWorktrees(db: Database.Database): DoctorCheck {
  const root = join(homedir(), ".exegol", "worktrees");
  const STALE_DAYS = 7;
  try {
    if (!existsSync(root)) {
      return {
        id: "stale-worktrees",
        label: "Worktree hygiene",
        status: "ok",
        detail: "No managed worktrees on disk",
        category: "config",
      };
    }
    const livePaths = new Set(
      (
        db
          .prepare(
            `SELECT w.path FROM worktrees w
             JOIN agents a ON a.worktree_id = w.id
             WHERE a.status IN ('idle','spawning','running','waiting_input','paused')`,
          )
          .all() as Array<{ path: string }>
      ).map((r) => r.path),
    );
    const cutoff = Date.now() - STALE_DAYS * 86_400_000;
    let stale = 0;
    let total = 0;
    for (const project of readdirSync(root)) {
      const projectDir = join(root, project);
      if (!statSync(projectDir).isDirectory()) continue;
      for (const wt of readdirSync(projectDir)) {
        const wtPath = join(projectDir, wt);
        if (!statSync(wtPath).isDirectory()) continue;
        total++;
        if (!livePaths.has(wtPath) && statSync(wtPath).mtimeMs < cutoff) stale++;
      }
    }
    return {
      id: "stale-worktrees",
      label: "Worktree hygiene",
      status: stale > 0 ? "warn" : "ok",
      detail:
        stale > 0
          ? `${stale} of ${total} worktree(s) in ~/.exegol/worktrees have no live agent and are >${STALE_DAYS} days old — review in Project > worktrees (dirty ones are preserved by design)`
          : `${total} managed worktree(s), none stale`,
      category: "config",
    };
  } catch (err) {
    return {
      id: "stale-worktrees",
      label: "Worktree hygiene",
      status: "warn",
      detail: `Could not scan ~/.exegol/worktrees: ${err instanceof Error ? err.message : String(err)}`,
      category: "config",
    };
  }
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function runDoctorChecks(db: Database.Database): Promise<DoctorReport> {
  const s = getAppSettings(db);
  const ollamaConfig = { url: s.ollamaUrl, model: s.ollamaModel };
  const [cliChecks, gitVersion, ghAvailable, ollama, mcpCheck] = await Promise.all([
    runCliDetection(),
    checkGitVersion(),
    checkCommandAvailable("gh"),
    checkOllamaStatus(ollamaConfig),
    checkMcpSocket(),
  ]);

  const checks: DoctorCheck[] = [...cliChecks];

  checks.push({
    id: "git",
    label: "Git",
    status: gitVersion ? "ok" : "fail",
    detail: gitVersion ?? "git not found on PATH — required for worktrees and version control",
    actionUrl: gitVersion ? undefined : "https://git-scm.com/downloads",
    category: "system",
  });

  checks.push({
    id: "gh-cli",
    label: "GitHub CLI (gh)",
    status: ghAvailable ? "ok" : "warn",
    detail: ghAvailable
      ? "Found 'gh' on PATH — Smart Git Button can create/merge PRs"
      : "Not found — PR creation/merge falls back to opening GitHub in the browser",
    actionUrl: ghAvailable ? undefined : "https://cli.github.com",
    category: "system",
  });

  checks.push({
    id: "native-module",
    label: "Native module (git2 + PTY)",
    status: coreRust ? "ok" : "fail",
    detail: coreRust
      ? "Rust native module loaded — worktrees, diff, and oplog are available"
      : "Native module failed to load — worktree isolation and fast diff are unavailable",
    category: "system",
  });

  checks.push({
    id: "ollama",
    label: "Ollama (local embeddings)",
    status: ollama.available ? (ollama.modelInstalled ? "ok" : "warn") : "warn",
    detail: ollama.available
      ? ollama.modelInstalled
        ? `Reachable at ${ollamaConfig.url} — model '${ollamaConfig.model}' ready, hybrid memory search enabled`
        : `Reachable, but model '${ollamaConfig.model}' is missing — run: ollama pull ${ollamaConfig.model}`
      : "Not running — memory search falls back to keyword-only",
    actionUrl: ollama.available ? undefined : "https://ollama.com",
    category: "system",
  });

  checks.push(checkPtySidecar());
  checks.push(mcpCheck);

  // Linux without a keyring (libsecret / kwallet) "encrypts" with a built-in key: say so
  const weakLinuxKeyring =
    process.platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text";
  checks.push({
    id: "keystore",
    label: "Keystore encryption",
    status: safeStorage.isEncryptionAvailable() && !weakLinuxKeyring ? "ok" : "warn",
    detail: weakLinuxKeyring
      ? "No desktop keyring found (install gnome-keyring or kwallet): API keys use a weak built-in key"
      : safeStorage.isEncryptionAvailable()
        ? "OS keychain encryption available — API keys stored encrypted"
        : "OS keychain encryption UNAVAILABLE — API keys are stored in plaintext in the local database",
    category: "config",
  });

  // Ports and dev servers are read with lsof, which minimal Linux installs lack
  if (process.platform === "linux" && !(await checkCommandAvailable("lsof"))) {
    checks.push({
      id: "lsof",
      label: "lsof",
      status: "warn",
      detail:
        "Not installed: the browser port chips and dev server list stay empty (apt install lsof)",
      category: "system",
    });
  }

  checks.push(checkStaleWorktrees(db));

  const anthropicKey = getApiKey(db, "anthropic") ?? process.env.ANTHROPIC_API_KEY;
  const openaiKey = getApiKey(db, "openai") ?? process.env.OPENAI_API_KEY;
  checks.push({
    id: "api-keys",
    label: "API Keys",
    status: anthropicKey || openaiKey ? "ok" : "warn",
    detail:
      anthropicKey || openaiKey
        ? "At least one provider key is configured"
        : "No API keys configured yet — add one in Settings > API Keys",
    category: "config",
  });

  return { checks, generatedAt: Date.now() };
}
