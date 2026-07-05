import { exec } from "node:child_process";
import { promisify } from "node:util";
import type Database from "libsql";
import { getProviderRegistry } from "../agents/registry";
import { _getFullPath, coreRust } from "../agents/spawn-env";
import { getApiKey } from "../security/keystore";

const execAsync = promisify(exec);

// Packaged macOS Electron inherits launchd's stripped PATH — Homebrew CLIs
// (claude, gh, ollama...) are invisible to it. _getFullPath resolves the
// user's login-shell PATH exactly like agent spawns do; without this the
// onboarding wizard reports every installed CLI as missing on first run.
const shellEnv = { ...process.env, PATH: _getFullPath() };

// ─── Types ──────────────────────────────────────────────────────────────────

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  actionUrl?: string;
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

async function checkGitVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync("git --version", { timeout: 3_000, env: shellEnv });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function checkOllamaRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_000);
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function runCliDetection(): Promise<DoctorCheck[]> {
  const providers = getProviderRegistry()
    .listBuiltin()
    .filter((p) => p.id !== "shell");

  return Promise.all(
    providers.map(async (provider) => {
      const installed = await checkCommandAvailable(provider.command);
      return {
        id: `cli:${provider.id}`,
        label: provider.name,
        status: installed ? "ok" : "warn",
        detail: installed
          ? `Found '${provider.command}' on PATH`
          : `'${provider.command}' not found on PATH`,
        actionUrl: installed ? undefined : CLI_INSTALL_LINKS[provider.id],
      } satisfies DoctorCheck;
    }),
  );
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function runDoctorChecks(db: Database.Database): Promise<DoctorReport> {
  const [cliChecks, gitVersion, ghAvailable, ollamaRunning] = await Promise.all([
    runCliDetection(),
    checkGitVersion(),
    checkCommandAvailable("gh"),
    checkOllamaRunning(),
  ]);

  const checks: DoctorCheck[] = [...cliChecks];

  checks.push({
    id: "git",
    label: "Git",
    status: gitVersion ? "ok" : "fail",
    detail: gitVersion ?? "git not found on PATH — required for worktrees and version control",
    actionUrl: gitVersion ? undefined : "https://git-scm.com/downloads",
  });

  checks.push({
    id: "gh-cli",
    label: "GitHub CLI (gh)",
    status: ghAvailable ? "ok" : "warn",
    detail: ghAvailable
      ? "Found 'gh' on PATH — Smart Git Button can create/merge PRs"
      : "Not found — PR creation/merge falls back to opening GitHub in the browser",
    actionUrl: ghAvailable ? undefined : "https://cli.github.com",
  });

  checks.push({
    id: "native-module",
    label: "Native module (git2 + PTY)",
    status: coreRust ? "ok" : "fail",
    detail: coreRust
      ? "Rust native module loaded — worktrees, diff, and oplog are available"
      : "Native module failed to load — worktree isolation and fast diff are unavailable",
  });

  checks.push({
    id: "ollama",
    label: "Ollama (local embeddings)",
    status: ollamaRunning ? "ok" : "warn",
    detail: ollamaRunning
      ? "Reachable at 127.0.0.1:11434 — hybrid memory search enabled"
      : "Not running — memory search falls back to keyword-only",
    actionUrl: ollamaRunning ? undefined : "https://ollama.com",
  });

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
  });

  return { checks, generatedAt: Date.now() };
}
