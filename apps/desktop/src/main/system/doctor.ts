import { exec } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DoctorCheck, DoctorReport, DoctorStatus } from "@exegol/shared";
import { safeStorage } from "electron";
import type Database from "libsql";
import { getProviderRegistry } from "../agents/registry";
import { _getFullPath, coreRust } from "../agents/spawn-env";
import { getAppSettings } from "../db/queries/settings";
import { checkOllamaStatus } from "../indexer/ollama-client";
import { getApiKey } from "../security/keystore";
import { cliSetupFor, findAllOnPath, providerBinaries, readBinaryVersion } from "./cli-versions";

const execAsync = promisify(exec);

// Packaged macOS Electron inherits launchd's stripped PATH — Homebrew CLIs
// (claude, gh, ollama...) are invisible to it. _getFullPath resolves the
// user's login-shell PATH exactly like agent spawns do; without this the
// onboarding wizard reports every installed CLI as missing on first run.
// Lazy: resolving it at import ran a login shell before the window existed
const shellEnv = () => ({ ...process.env, PATH: _getFullPath() });

// ─── Types ──────────────────────────────────────────────────────────────────

export type { DoctorCategory, DoctorCheck, DoctorReport, DoctorStatus } from "@exegol/shared";

// ─── Individual checks ──────────────────────────────────────────────────────

function checkCommandAvailable(command: string): Promise<boolean> {
  const cmd = process.platform === "win32" ? `where "${command}"` : `which "${command}"`;
  return new Promise((resolve) =>
    exec(cmd, { env: shellEnv(), timeout: 3_000 }, (err) => resolve(!err)),
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
      for (const cmd of providerBinaries(provider.command)) {
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
      const setup = cliSetupFor(provider.id);
      if (setup?.deprecated) detail = `${detail} · ${setup.deprecated}`;
      return {
        id: `cli:${provider.id}`,
        label: provider.name,
        status: installed ? (duplicated ? "warn" : "ok") : "warn",
        detail,
        actionUrl: installed ? undefined : setup?.docs,
        installCommand: installed ? undefined : (setup?.install ?? undefined),
        updateCommand: installed ? (setup?.update ?? undefined) : undefined,
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
