// Agent wrapper scripts + lifecycle hook injection for Claude Code and Codex.
// Creates ~/.exegol/hooks/notify.sh for lifecycle event notification.
// Keeps Exegol's guarded entries in ~/.claude/settings.json and ~/.codex/hooks.json.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_ATTENTION_NOTIFICATIONS,
  CLAUDE_IDLE_NOTIFICATIONS,
  CLAUDE_SESSION_READY_SOURCES,
} from "@exegol/shared";
import { logger } from "../lib/logger";

const EXEGOL_DIR = join(homedir(), ".exegol");
export const HOOKS_DIR = join(EXEGOL_DIR, "hooks");
const EVENTS_DIR = join(EXEGOL_DIR, "events");
const NOTIFY_SCRIPT = join(HOOKS_DIR, "notify.sh");
const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");
const CODEX_HOOKS = join(homedir(), ".codex", "hooks.json");

/** Initialize wrapper scripts and agent hooks. Call once on startup. */
export function ensureAgentWrappers(): void {
  try {
    mkdirSync(HOOKS_DIR, { recursive: true });
    mkdirSync(EVENTS_DIR, { recursive: true });
    createNotifyScript();
    mergeClaudeHooks();
    mergeCodexHooks();
    logger.info("[AgentWrappers] Agent wrappers initialized");
  } catch (err) {
    logger.error("[AgentWrappers] Failed to initialize:", err);
  }
}

/**
 * Sweep leftover hook events.
 *
 * Runs at STARTUP, not at quit. The hook writes one file per tool_use, so a
 * fleet whose watcher missed events can leave thousands behind — and an
 * unbounded synchronous unlink loop on the quit path is exactly the kind of
 * work that makes an app take seconds to close. Capping it there instead would
 * have traded a slow quit for an unbounded disk leak, since nothing else sweeps
 * this directory (`cleanupOldEvents` prunes a DB table, not these files).
 */
export function sweepStaleAgentEvents(): void {
  try {
    for (const file of readdirSync(EVENTS_DIR)) {
      try {
        unlinkSync(join(EVENTS_DIR, file));
      } catch {
        /* */
      }
    }
  } catch {
    /* */
  }
}

// ─── Notify Script ──────────────────────────────────────────────────────

function createNotifyScript(): void {
  const script = `#!/bin/bash
# Exegol lifecycle notification hook.
# Usage: notify.sh <event_type>
# Called by agent hooks (Claude Code, Codex, etc.) on lifecycle events.
# Only fires for Exegol-managed agents (EXEGOL_AGENT_ID must be set).
[ -z "$EXEGOL_AGENT_ID" ] && exit 0
EVENT_DIR="$HOME/.exegol/events"
mkdir -p "$EVENT_DIR"
EVENT_TYPE="\${1:-unknown}"
TS=$(date +%s)
# Claude Code pipes the hook payload on stdin; its session_id is what
# "claude --resume" needs after the PTY dies (a reboot leaves no exit output)
SID=""
if [ ! -t 0 ]; then
  # Drain all of it (stopping early would break Claude's pipe); the id sits near the start
  INPUT=$(cat)
  SID=$(printf '%s' "\${INPUT:0:4096}" | tr -d '\\n' | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([A-Za-z0-9-]*\\)".*/\\1/p')
fi
echo "{\\"type\\":\\"$EVENT_TYPE\\",\\"agentId\\":\\"$EXEGOL_AGENT_ID\\",\\"ts\\":$TS,\\"sessionId\\":\\"$SID\\"}" \\
  > "$EVENT_DIR/\${EXEGOL_AGENT_ID}_\${EVENT_TYPE}_\${TS}.json"
`;
  writeFileSync(NOTIFY_SCRIPT, script, { mode: 0o755 });
}

// ─── Global hooks (Claude Code + Codex use the same format) ─────────────
//
// A spawned Claude session gets its file-event hooks from its per-agent `--settings` file. The
// global files stay for what has no per-session file: a `claude` typed in an Exegol terminal, and
// codex. Their guard runs in the hook's own shell, so outside Exegol nothing else starts.

interface HookAction {
  type: string;
  command: string;
}

interface HookDef {
  matcher?: string;
  hooks: HookAction[];
}

export interface ManagedHook {
  event: string;
  def: HookDef;
}

/** Set on a spawned Claude session whose `--settings` file already drops the file events */
export const HOOKS_FILE_ENV = "EXEGOL_HOOKS_FILE";

const NOTIFY_EVENTS = [
  "stop",
  "tool_use",
  "prompt_submit",
  "permission_needed",
  "session_ready",
  "session_start",
] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

/** What releases before this one wrote: it started notify.sh for every session on the machine */
const legacyNotifyCommand = (event: string, script: string) =>
  `[ -x "${script}" ] && "${script}" ${event}`;

/** A file-event hook. `global` does nothing unless the session is Exegol's and has no own file */
export function notifyCommand(
  event: NotifyEvent,
  scope: "global" | "agent",
  script = NOTIFY_SCRIPT,
): string {
  const guard =
    scope === "global" ? `[ -n "$EXEGOL_AGENT_ID" ] && [ -z "$${HOOKS_FILE_ENV}" ] && ` : "";
  return `if ${guard}[ -x "${script}" ]; then "${script}" ${event}; fi`;
}

/** Every command an Exegol release wrote to a global file: only these are ever removed */
function ownedCommands(script: string): Set<string> {
  return new Set(
    NOTIFY_EVENTS.flatMap((e) => [
      legacyNotifyCommand(e, script),
      notifyCommand(e, "global", script),
    ]),
  );
}

/** Exact match on every command of the entry: a user hook that merely mentions exegol is kept */
export function isExegolHook(def: HookDef, script = NOTIFY_SCRIPT): boolean {
  const owned = ownedCommands(script);
  return (
    Array.isArray(def?.hooks) &&
    def.hooks.length > 0 &&
    def.hooks.every((h) => h?.type === "command" && owned.has(h.command))
  );
}

export interface HooksMerge {
  settings: Record<string, unknown>;
  removed: number;
  added: number;
}

/**
 * The settings with exactly `managed` as Exegol's entries. Other entries keep their place, and
 * an event whose Exegol entries already match is left alone, so a second run changes nothing.
 * `managed` empty is the uninstall.
 */
export function withExegolHooks(
  settings: Record<string, unknown>,
  managed: ManagedHook[],
  script = NOTIFY_SCRIPT,
): HooksMerge {
  const current = settings.hooks;
  if (current !== undefined && (!current || typeof current !== "object" || Array.isArray(current)))
    return { settings, removed: 0, added: 0 };
  const hooks: Record<string, unknown> = { ...(current as Record<string, unknown> | undefined) };
  const isOurs = (d: unknown) => isExegolHook(d as HookDef, script);
  const events = new Set([
    ...managed.map((m) => m.event),
    ...Object.keys(hooks).filter((e) => {
      const defs = hooks[e];
      return Array.isArray(defs) && defs.some(isOurs);
    }),
  ]);
  let removed = 0;
  let added = 0;
  for (const event of events) {
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    const ours = existing.filter(isOurs);
    const desired = managed.filter((m) => m.event === event).map((m) => m.def);
    if (JSON.stringify(ours) === JSON.stringify(desired)) continue;
    removed += ours.length;
    added += desired.length;
    const next = [...existing.filter((d) => !isOurs(d)), ...desired];
    if (next.length > 0) hooks[event] = next;
    else delete hooks[event];
  }
  if (removed + added === 0) return { settings, removed, added };
  return { settings: { ...settings, hooks }, removed, added };
}

/** The file's own indent and final newline, so a rewrite only shows the hooks in a diff */
export function formatLike(original: string, value: unknown): string {
  const indent = /^\{\r?\n([ \t]+)\S/.exec(original)?.[1] ?? 2;
  const body = JSON.stringify(value, null, indent);
  return original === "" || original.endsWith("\n") ? `${body}\n` : body;
}

/** Rewrite a hooks file only when Exegol's entries change, after a backup of what was there */
function syncHooksFile(path: string, label: string, managed: ManagedHook[]): void {
  try {
    const original = existsSync(path) ? readFileSync(path, "utf-8") : "";
    let settings: unknown = {};
    if (original.trim()) {
      try {
        settings = JSON.parse(original);
      } catch {
        // Never overwrite a file the user wrote by hand just because we can't parse it
        logger.warn(`[AgentWrappers] ${label} is not valid JSON, leaving it alone`);
        return;
      }
    }
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      logger.warn(`[AgentWrappers] ${label} is not a JSON object, leaving it alone`);
      return;
    }
    const merge = withExegolHooks(settings as Record<string, unknown>, managed);
    if (merge.removed + merge.added === 0) return;
    const mode = original ? statSync(path).mode & 0o777 : 0o644;
    if (original) writeFileSync(`${path}.exegol-backup`, original, { mode });
    // Renamed into place: a CLI starting meanwhile never reads half a file
    const tmp = `${path}.exegol-tmp`;
    writeFileSync(tmp, formatLike(original, merge.settings), { mode });
    renameSync(tmp, path);
    logger.info(
      `[AgentWrappers] ${label}: ${merge.removed} Exegol hook entries removed, ${merge.added} added`,
    );
  } catch (err) {
    logger.warn(`[AgentWrappers] Failed to update ${label}:`, err);
  }
}

const globalRun = (event: NotifyEvent, script: string) => [
  { type: "command", command: notifyCommand(event, "global", script) },
];

/** The per-agent file's file events, for a `claude` typed in an Exegol terminal */
export function claudeGlobalHooks(script = NOTIFY_SCRIPT): ManagedHook[] {
  return [
    { event: "Stop", def: { hooks: globalRun("stop", script) } },
    { event: "PostToolUse", def: { matcher: "*", hooks: globalRun("tool_use", script) } },
    { event: "UserPromptSubmit", def: { hooks: globalRun("prompt_submit", script) } },
    {
      event: "Notification",
      def: {
        matcher: CLAUDE_ATTENTION_NOTIFICATIONS,
        hooks: globalRun("permission_needed", script),
      },
    },
    {
      event: "Notification",
      def: { matcher: CLAUDE_IDLE_NOTIFICATIONS, hooks: globalRun("session_ready", script) },
    },
    {
      event: "SessionStart",
      def: { matcher: CLAUDE_SESSION_READY_SOURCES, hooks: globalRun("session_ready", script) },
    },
  ];
}

/** Codex has no per-session hooks file, so every codex session Exegol runs reads these */
export function codexGlobalHooks(script = NOTIFY_SCRIPT): ManagedHook[] {
  return [
    { event: "SessionStart", def: { hooks: globalRun("session_start", script) } },
    { event: "Stop", def: { hooks: globalRun("stop", script) } },
  ];
}

function mergeClaudeHooks(): void {
  if (!existsSync(CLAUDE_SETTINGS)) return;
  syncHooksFile(CLAUDE_SETTINGS, "~/.claude/settings.json", claudeGlobalHooks());
}

function mergeCodexHooks(): void {
  if (!existsSync(join(homedir(), ".codex"))) return; // Codex not installed
  syncHooksFile(CODEX_HOOKS, "~/.codex/hooks.json", codexGlobalHooks());
}

export function getEventsDir(): string {
  return EVENTS_DIR;
}
