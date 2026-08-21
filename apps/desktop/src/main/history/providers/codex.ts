import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { FILE_CONCURRENCY, mapWithConcurrency } from "../pool";
import { readHead } from "../read-head";
import type { LocalHistoryProvider, LocalSession } from "../types";

interface SessionMeta {
  timestamp?: string;
  payload?: {
    session_id?: string;
    cwd?: string;
    timestamp?: string;
    cli_version?: string;
    git?: { branch?: string };
    /** "user" for a session a person started; "subagent" for codex's own
     *  internal rollouts (one per turn its guardian assesses). */
    thread_source?: string;
  };
}

/**
 * Everything codex injects before the person gets a word in. Skipping these is
 * what separates "what did I ask for" from the scaffolding around it.
 */
/** Enough to clear session_meta + world_state and reach the first real turn. */
const TITLE_SCAN_BYTES = 512 * 1024;

const BOILERPLATE_PREFIXES = [
  "# AGENTS.md instructions",
  "<permissions instructions",
  "The following is the Codex agent history",
  "<user_instructions",
  "<environment_context",
  "## My request for Codex:",
];

interface RolloutLine {
  payload?: {
    type?: string;
    role?: string;
    message?: string;
    content?: Array<{ text?: string }>;
  };
}

/** codex records no title, but it does record what the person typed. */
function firstUserPrompt(head: string): string | null {
  for (const raw of head.split("\n")) {
    if (!raw.startsWith("{")) continue;
    let line: RolloutLine;
    try {
      line = JSON.parse(raw) as RolloutLine;
    } catch {
      continue; // the tail of a 64 KB read is normally truncated
    }
    const p = line.payload;
    const text =
      p?.type === "user_message"
        ? p.message
        : p?.type === "message" && p.role === "user"
          ? (p.content ?? []).map((c) => c.text ?? "").join("")
          : null;

    const trimmed = text?.trim();
    if (!trimmed || trimmed.length < 3) continue;
    if (BOILERPLATE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) continue;
    return trimmed.replace(/\s+/g, " ").slice(0, 120);
  }
  return null;
}

async function subdirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Latest instant a `YYYY[/MM[/DD]]` path prefix could contain. */
function endOfPeriod(parts: string[]): number {
  const [year, month = "12", day = "31"] = parts;
  const parsed = Date.parse(`${year}-${month}-${day}T23:59:59Z`);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : Math.floor(parsed / 1000);
}

/**
 * `sessions/YYYY/MM/DD/` — the date is in the PATH, so a window prunes whole
 * years and months instead of stat-ing 750 files. Levels are walked in parallel:
 * 158 day directories one round-trip at a time is latency for nothing.
 */
async function dayDirs(root: string, since: number): Promise<string[]> {
  const years = (await subdirs(root)).filter((y) => endOfPeriod([y]) >= since);

  const months = await Promise.all(
    years.map(async (year) =>
      (await subdirs(join(root, year)))
        .filter((month) => endOfPeriod([year, month]) >= since)
        .map((month) => [year, month] as const),
    ),
  );

  const days = await Promise.all(
    months
      .flat()
      .map(async ([year, month]) =>
        (await subdirs(join(root, year, month)))
          .filter((day) => endOfPeriod([year, month, day]) >= since)
          .map((day) => join(root, year, month, day)),
      ),
  );

  return days.flat();
}

export const codexHistory: LocalHistoryProvider = {
  id: "codex",

  async list(cwds: string[], since: number): Promise<LocalSession[]> {
    const root = join(homedir(), ".codex", "sessions");
    const dirs = await dayDirs(root, since);

    const paths = (
      await Promise.all(
        dirs.map(async (dir) => {
          try {
            return (await readdir(dir))
              .filter((f) => f.endsWith(".jsonl"))
              .map((f) => join(dir, f));
          } catch {
            return [];
          }
        }),
      )
    ).flat();

    const sessions = await mapWithConcurrency(paths, FILE_CONCURRENCY, (path) =>
      readRollout(path, cwds),
    );
    return sessions.filter((s): s is LocalSession => s !== null);
  },
};

async function readRollout(path: string, cwds: string[]): Promise<LocalSession | null> {
  try {
    // The first line embeds the model's full base_instructions and runs 15-22 KB
    // (measured), so a short read truncates it, JSON.parse fails, and every
    // codex session disappears without an error.
    const { head, sizeBytes, modifiedAt } = await readHead(path);
    const firstLine = head.split("\n", 1)[0];
    if (!firstLine) return null;

    // Cheap reject before the 20 KB parse: most rollouts belong to other repos.
    if (!cwds.some((cwd) => firstLine.includes(`"${cwd}"`))) return null;

    const meta = JSON.parse(firstLine) as SessionMeta;
    const cwd = meta.payload?.cwd;
    if (!cwd || !cwds.includes(cwd)) return null;

    // codex writes a rollout per internal guardian assessment too, one for every
    // turn it reviews. Those are machinery, not sessions a person ran — listed,
    // they bury the real ones under near-identical rows (four of six, measured
    // on this machine).
    if (meta.payload?.thread_source && meta.payload.thread_source !== "user") return null;

    // Only NOW is a bigger read worth it: session_meta alone runs 20 KB and the
    // world_state that follows can dwarf it, so the person's first message sits
    // well past the matching head. Two reads, but only for the handful of
    // rollouts that belong to this repo.
    const { head: deepHead } = await readHead(path, TITLE_SCAN_BYTES);

    const started = meta.payload?.timestamp ?? meta.timestamp;
    return {
      provider: "codex",
      sessionId:
        meta.payload?.session_id ??
        path
          .split("/")
          .pop()
          ?.replace(/\.jsonl$/, "") ??
        path,
      // codex records no title; the rollout is identified by when it ran and,
      // usefully, by the branch it ran against.
      // codex records no title of its own, but it does record what the person
      // typed — which is the only thing that tells two rollouts apart.
      title: firstUserPrompt(deepHead),
      cwd,
      branch: meta.payload?.git?.branch ?? null,
      startedAt: started ? Math.floor(Date.parse(started) / 1000) : null,
      endedAt: modifiedAt,
      version: meta.payload?.cli_version ?? null,
      sizeBytes,
    };
  } catch {
    return null; // malformed or unreadable rollout — skip it
  }
}
