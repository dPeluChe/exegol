import { exec } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_SETTINGS } from "@exegol/shared";
import { safeStorage } from "electron";
import type Database from "libsql";
import { getProviderRegistry } from "../agents/registry";
import { _getFullPath, coreRust } from "../agents/spawn-env";
import { checkOllamaStatus } from "../indexer/ollama-client";
import { getApiKey } from "../security/keystore";

const execAsync = promisify(exec);

// Packaged macOS Electron inherits launchd's stripped PATH — Homebrew CLIs
// (claude, gh, ollama...) are invisible to it. _getFullPath resolves the
// user's login-shell PATH exactly like agent spawns do; without this the
// onboarding wizard reports every installed CLI as missing on first run.
const shellEnv = { ...process.env, PATH: _getFullPath() };

// ─── Types ──────────────────────────────────────────────────────────────────

export type DoctorStatus = "ok" | "warn" | "fail";

/** Grouping for the Doctor UI: agent CLIs vs system services/deps vs configuration. */
export type DoctorCategory = "agents" | "system" | "config";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  actionUrl?: string;
  category: DoctorCategory;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  generatedAt: number;
}

// ─── Install links (shown next to a missing CLI) ───────────────────────────

const CLI_INSTALL_LINKS: Partial<Record<string, string>> = {
  "claude-code": "https://docs.claude.com/en/docs/claude-code",
  codex: "https://github.com/openai/codex",
  gemini: "https://github.com/google-gemini/gemini-cli",
  aider: "https://aider.chat",
  goose: "https://block.github.io/goose",
  opencode: "https://opencode.ai",
  amp: "https://ampcode.com",
  kiro: "https://kiro.dev",
  kilocode: "https://kilocode.ai",
  crush: "https://github.com/charmbracelet/crush",
  "factory-droid": "https://factory.ai",
};

// ─── Individual checks ──────────────────────────────────────────────────────

function checkCommandAvailable(command: string): Promise<boolean> {
  const cmd = process.platform === "win32" ? `where "${command}"` : `which "${command}"`;
  return new Promise((resolve) => exec(cmd, { env: shellEnv }, (err) => resolve(!err)));
}

/** All PATH hits for a command (`which -a` / `where` both list every match). */
function findAllOnPath(command: string): Promise<string[]> {
  const cmd = process.platform === "win32" ? `where "${command}"` : `which -a "${command}"`;
  return new Promise((resolve) =>
    exec(cmd, { env: shellEnv }, (err, stdout) =>
      resolve(err ? [] : [...new Set(stdout.trim().split("\n").filter(Boolean))]),
    ),
  );
}

async function checkGitVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git --version", { timeout: 3_000, env: shellEnv });
    return stdout.trim();
  } catch {
    return null;
  }
}

function readOllamaConfig(db: Database.Database): { url: string; model: string } {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'app_settings'").get() as
      | { value: string }
      | undefined;
    const s = row ? (JSON.parse(row.value) as { ollamaUrl?: string; ollamaModel?: string }) : {};
    return {
      url: s.ollamaUrl ?? DEFAULT_SETTINGS.ollamaUrl,
      model: s.ollamaModel ?? DEFAULT_SETTINGS.ollamaModel,
    };
  } catch {
    return { url: DEFAULT_SETTINGS.ollamaUrl, model: DEFAULT_SETTINGS.ollamaModel };
  }
}

/** Best-effort `--version` for a specific binary path (duplicate-install detail). */
function readBinaryVersion(binPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    exec(`"${binPath}" --version`, { env: shellEnv, timeout: 3_000 }, (err, stdout) => {
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
      const paths = await findAllOnPath(provider.command);
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
      } else {
        detail = installed
          ? `Found '${provider.command}' on PATH`
          : `'${provider.command}' not found on PATH`;
      }
      return {
        id: `cli:${provider.id}`,
        label: provider.name,
        status: installed ? (duplicated ? "warn" : "ok") : "warn",
        detail,
        actionUrl: installed ? undefined : CLI_INSTALL_LINKS[provider.id],
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
  const ollamaConfig = readOllamaConfig(db);
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

  checks.push({
    id: "keystore",
    label: "Keystore encryption",
    status: safeStorage.isEncryptionAvailable() ? "ok" : "warn",
    detail: safeStorage.isEncryptionAvailable()
      ? "OS keychain encryption available — API keys stored encrypted"
      : "OS keychain encryption UNAVAILABLE — API keys are stored in plaintext in the local database",
    category: "config",
  });

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
