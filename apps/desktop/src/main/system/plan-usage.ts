import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PlanUsage, PlanWindow } from "@exegol/shared";
import { dayDirs } from "../history/providers/codex";
import { readTail } from "../history/read-head";
import { logger } from "../lib/logger";

const execFileAsync = promisify(execFile);

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
/** The endpoint rate-limits hard: one read every 2 min, 5 min quiet after a 429 or with no login */
const CLAUDE_TTL_MS = 120_000;
const CLAUDE_QUIET_MS = 5 * 60_000;

interface ClaudeToken {
  accessToken: string;
  expiresAt: number;
}

/** The token the Claude CLI keeps (macOS keychain first, then its credentials file). Read
 *  only: never refreshed here, so Exegol can not rotate the CLI's own login */
async function readClaudeToken(): Promise<ClaudeToken | null> {
  const parse = (raw: string): ClaudeToken | null => {
    try {
      const oauth = (JSON.parse(raw) as { claudeAiOauth?: ClaudeToken }).claudeAiOauth;
      return oauth?.accessToken ? oauth : null;
    } catch {
      return null;
    }
  };
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync(
        "security",
        ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE, "-w"],
        { timeout: 3000 },
      );
      const token = parse(stdout.trim());
      if (token) return token;
    } catch {
      /* not logged in through the keychain */
    }
  }
  try {
    return parse(await readFile(join(homedir(), ".claude", ".credentials.json"), "utf-8"));
  } catch {
    return null;
  }
}

interface UsageWindowJson {
  utilization?: number | null;
  resets_at?: string | null;
}

export function claudeWindow(
  w: UsageWindowJson | null | undefined,
  minutes: number,
): PlanWindow | null {
  if (typeof w?.utilization !== "number") return null;
  const resetsAt = w.resets_at ? Date.parse(w.resets_at) : Number.NaN;
  return {
    usedPercent: w.utilization,
    resetsAt: Number.isNaN(resetsAt) ? null : resetsAt,
    windowMins: minutes,
  };
}

let claudeLast: Omit<PlanUsage, "stale"> | null = null;
let claudeQuietUntil = 0;
let claudeInFlight: Promise<void> | null = null;

/** The last good reading; stale once it is older than a refresh */
function claudeReading(): PlanUsage | null {
  return claudeLast && { ...claudeLast, stale: Date.now() - claudeLast.fetchedAt > CLAUDE_TTL_MS };
}

async function refreshClaude(): Promise<void> {
  const token = await readClaudeToken();
  if (!token || token.expiresAt < Date.now()) {
    claudeQuietUntil = Date.now() + CLAUDE_QUIET_MS;
    return;
  }
  const res = await fetch(CLAUDE_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "exegol",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    if (res.status === 429) claudeQuietUntil = Date.now() + CLAUDE_QUIET_MS;
    logger.warn(`[PlanUsage] Claude usage answered ${res.status}`);
    return;
  }
  const body = (await res.json()) as { five_hour?: UsageWindowJson; seven_day?: UsageWindowJson };
  claudeLast = {
    cliType: "claude-code",
    session: claudeWindow(body.five_hour, 300),
    weekly: claudeWindow(body.seven_day, 10_080),
    fetchedAt: Date.now(),
  };
}

/** Claude's plan windows: at most one request per TTL, none while quiet (429, no login) */
async function claudePlanUsage(): Promise<PlanUsage | null> {
  const fresh = claudeLast && Date.now() - claudeLast.fetchedAt < CLAUDE_TTL_MS;
  if (!fresh && Date.now() >= claudeQuietUntil) {
    claudeInFlight ??= refreshClaude()
      .catch((err) => logger.warn("[PlanUsage] Claude usage failed:", err))
      .finally(() => {
        claudeInFlight = null;
      });
    await claudeInFlight;
  }
  return claudeReading();
}

interface CodexWindowJson {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

export function codexWindow(w: CodexWindowJson | null | undefined, now: number): PlanWindow | null {
  if (typeof w?.used_percent !== "number") return null;
  const resetsAt = typeof w.resets_at === "number" ? w.resets_at * 1000 : null;
  // A window that reset since Codex last wrote it is empty again
  const usedPercent = resetsAt !== null && resetsAt < now ? 0 : w.used_percent;
  return { usedPercent, resetsAt, windowMins: w.window_minutes ?? null };
}

const CODEX_ROOT = join(homedir(), ".codex", "sessions");
const CODEX_LOOKBACK_S = 14 * 86_400;
const TAIL_BYTES = 512 * 1024;

/** The newest rollout: day directories sort by date, files by their timestamped names */
async function newestRollout(): Promise<string | null> {
  const days = (await dayDirs(CODEX_ROOT, Math.floor(Date.now() / 1000) - CODEX_LOOKBACK_S)).sort();
  for (const day of days.reverse()) {
    const files = (await readdir(day).catch(() => [] as string[]))
      .filter((f) => f.endsWith(".jsonl"))
      .sort();
    const last = files.at(-1);
    if (last) return join(day, last);
  }
  return null;
}

let codexLast: { file: string; mtimeMs: number; usage: PlanUsage | null } | null = null;

/** Codex writes its plan windows into each session log: read the latest one, no network and no
 *  credentials (as of its last turn). Re-read only when that file changed */
async function codexPlanUsage(): Promise<PlanUsage | null> {
  const file = await newestRollout();
  if (!file) return null;
  const info = await stat(file);
  if (codexLast?.file === file && codexLast.mtimeMs === info.mtimeMs) {
    return codexLast.usage && { ...codexLast.usage, ...refreshWindows(codexLast.usage) };
  }
  const tail = await readTail(file, info.size, TAIL_BYTES);
  const at = tail.lastIndexOf('"rate_limits"');
  const lineStart = tail.lastIndexOf("\n", at) + 1;
  const lineEnd = tail.indexOf("\n", at);
  let usage: PlanUsage | null = null;
  if (at >= 0) {
    try {
      const entry = JSON.parse(tail.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)) as {
        timestamp?: string;
        payload?: { rate_limits?: { primary?: CodexWindowJson; secondary?: CodexWindowJson } };
      };
      const limits = entry.payload?.rate_limits;
      if (limits) {
        const now = Date.now();
        usage = {
          cliType: "codex",
          session: codexWindow(limits.primary, now),
          weekly: codexWindow(limits.secondary, now),
          fetchedAt: entry.timestamp ? Date.parse(entry.timestamp) : now,
          stale: false,
        };
      }
    } catch {
      /* a line cut by the tail: no reading */
    }
  }
  codexLast = { file, mtimeMs: info.mtimeMs, usage };
  return usage;
}

/** A cached Codex reading whose window has since reset reads empty */
function refreshWindows(u: PlanUsage): Pick<PlanUsage, "session" | "weekly"> {
  const reset = (w: PlanWindow | null) =>
    w && w.resetsAt !== null && w.resetsAt < Date.now() ? { ...w, usedPercent: 0 } : w;
  return { session: reset(u.session), weekly: reset(u.weekly) };
}

const READERS: Record<string, () => Promise<PlanUsage | null>> = {
  "claude-code": claudePlanUsage,
  codex: codexPlanUsage,
};

/** The plan windows of these CLIs, the ones with a readable source */
export async function planUsage(cliTypes: string[]): Promise<PlanUsage[]> {
  const results = await Promise.all(cliTypes.map((t) => READERS[t]?.().catch(() => null) ?? null));
  return results.filter((r): r is PlanUsage => r !== null);
}
