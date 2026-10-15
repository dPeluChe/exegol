// Agent wrapper scripts + lifecycle hook injection for Claude Code and Codex.
// Creates ~/.exegol/hooks/notify.sh for lifecycle event notification.
// Keeps Exegol's guarded entries in ~/.claude/settings.json and ~/.codex/hooks.json.

import { randomBytes } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
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
  writeFileSync(NOTIFY_SCRIPT, notifyScript(), { mode: 0o755 });
}

export function notifyScript(): string {
  return `#!/bin/bash
# Exegol lifecycle notification hook.
# Usage: notify.sh <event_type> [agent]
# Called by agent hooks (Claude Code, Codex, etc.) on lifecycle events.
# Only fires for Exegol-managed agents (EXEGOL_AGENT_ID must be set).
[ -z "$EXEGOL_AGENT_ID" ] && exit 0
# A session with its own hooks file gets its events from there ("agent"); a global entry an
# older Exegol build wrote unguarded must not send them twice
[ -n "$EXEGOL_HOOKS_FILE" ] && [ "$2" != "agent" ] && exit 0
EVENT_DIR="$HOME/.exegol/events"
mkdir -p "$EVENT_DIR"
EVENT_TYPE="\${1:-unknown}"
TS=$(date +%s)
# Claude Code pipes the hook payload on stdin; its session_id is what
# "claude --resume" needs after the PTY dies (a reboot leaves no exit output)
SID=""
CWD=""
if [ ! -t 0 ]; then
  # Drain all of it (stopping early would break Claude's pipe); the id sits near the start
  INPUT=$(cat)
  HEAD="\${INPUT:0:4096}"
  SID=$(printf '%s' "$HEAD" | tr -d '\\n' | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([A-Za-z0-9-]*\\)".*/\\1/p')
  # The session's folder now (a cd inside the CLI moves it): the first top-level "cwd", kept
  # JSON-escaped so it drops into the event as is
  AFTER="\${HEAD#*\\"cwd\\"}"
  if [ "$AFTER" != "$HEAD" ]; then
    CWD=$(printf '%s' "$AFTER" | tr -d '\\n' | sed -nE 's/^[[:space:]]*:[[:space:]]*"(([^"\\\\]|\\\\.)*)".*/\\1/p')
  fi
fi
echo "{\\"type\\":\\"$EVENT_TYPE\\",\\"agentId\\":\\"$EXEGOL_AGENT_ID\\",\\"ts\\":$TS,\\"sessionId\\":\\"$SID\\",\\"cwd\\":\\"$CWD\\"}" \\
  > "$EVENT_DIR/\${EXEGOL_AGENT_ID}_\${EVENT_TYPE}_\${TS}.json"
`;
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

/** Earlier forms, still recognized as Exegol's. The first ran notify.sh for every session */
const previousNotifyCommands = (event: string, script: string) => [
  `[ -x "${script}" ] && "${script}" ${event}`,
  `if [ -n "$EXEGOL_AGENT_ID" ] && [ -z "$${HOOKS_FILE_ENV}" ] && [ -x "${script}" ]; then "${script}" ${event}; fi`,
];

/**
 * A file-event hook, in a form sh, bash, zsh and fish all run, exiting 0 when skipped. `global`
 * does nothing unless the session is Exegol's and has no hooks file of its own.
 */
export function notifyCommand(
  event: NotifyEvent,
  scope: "global" | "agent",
  script = NOTIFY_SCRIPT,
): string {
  const run = `[ ! -x "${script}" ] || "${script}" ${event}`;
  return scope === "global"
    ? `[ -z "$EXEGOL_AGENT_ID" ] || [ -n "$${HOOKS_FILE_ENV}" ] || ${run}`
    : `${run} agent`;
}

/** Every command an Exegol release wrote to a global file: only these are ever removed */
function ownedCommands(script: string): Set<string> {
  return new Set(
    NOTIFY_EVENTS.flatMap((e) => [
      ...previousNotifyCommands(e, script),
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

/** What decides whether an Exegol entry changed; other keys (a user's "timeout") are kept */
const hookCore = (d: HookDef) => ({
  matcher: d.matcher,
  hooks: d.hooks.map((h) => ({ type: h.type, command: h.command })),
});

/** The new entries, keeping keys a user added to the Exegol entry they replace */
function carryExtraKeys(ours: HookDef[], desired: HookDef[]): HookDef[] {
  const left = [...ours];
  return desired.map((def) => {
    const i = left.findIndex((o) => o.matcher === def.matcher);
    const prev = left.splice(i >= 0 ? i : 0, 1)[0];
    if (!prev) return def;
    const { matcher: _m, hooks: prevHooks, ...extra } = prev;
    return {
      ...def,
      ...extra,
      hooks: def.hooks.map((h, j) => {
        const { type: _t, command: _c, ...actionExtra } = prevHooks[j] ?? ({} as HookAction);
        return { ...h, ...actionExtra };
      }),
    };
  });
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
    const value = hooks[event];
    // Not a list: not a shape we understand, so not ours to replace
    if (value !== undefined && !Array.isArray(value)) continue;
    const existing = (value as unknown[] | undefined) ?? [];
    const ours = existing.filter(isOurs) as HookDef[];
    const desired = managed.filter((m) => m.event === event).map((m) => m.def);
    if (JSON.stringify(ours.map(hookCore)) === JSON.stringify(desired.map(hookCore))) continue;
    removed += ours.length;
    added += desired.length;
    const next = [...existing.filter((d) => !isOurs(d)), ...carryExtraKeys(ours, desired)];
    if (next.length > 0) hooks[event] = next;
    else delete hooks[event];
  }
  if (removed + added === 0) return { settings, removed, added };
  return { settings: { ...settings, hooks }, removed, added };
}

const BOM = "﻿";

/** The file's own BOM, indent, line endings and final newline: a rewrite only shows the hooks */
export function formatLike(original: string, value: unknown): string {
  const text = original.startsWith(BOM) ? original.slice(1) : original;
  const indent = /^\{\r?\n([ \t]+)\S/.exec(text)?.[1] ?? 2;
  let body = JSON.stringify(value, null, indent);
  if (text === "" || text.endsWith("\n")) body += "\n";
  // JSON.stringify escapes newlines inside strings, so every raw \n here is a line break
  if (text.includes("\r\n")) body = body.replace(/\n/g, "\r\n");
  return original.startsWith(BOM) ? BOM + body : body;
}

const skipLogged = new Set<string>();
function skipOnce(label: string, why: string): void {
  if (skipLogged.has(label)) return;
  skipLogged.add(label);
  logger.warn(`[AgentWrappers] ${label} ${why}, leaving it alone`);
}

const writable = (path: string) => {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Rewrite a hooks file only when Exegol's entries change. A symlink (stow, chezmoi,
 * home-manager) is followed and the real file is written next to itself; a read-only file or
 * folder (a nix store) is skipped. The first rewrite keeps the original as `.exegol-backup`.
 * Returns whether it wrote.
 */
export function syncHooksFile(
  path: string,
  label: string,
  managed: ManagedHook[],
  script = NOTIFY_SCRIPT,
): boolean {
  try {
    const exists = existsSync(path);
    if (!exists && lstatSync(path, { throwIfNoEntry: false })) {
      skipOnce(label, "is a link to a missing file");
      return false;
    }
    const target = exists ? realpathSync(path) : path;
    if ((exists && !writable(target)) || !writable(dirname(target))) {
      skipOnce(label, "is read-only");
      return false;
    }
    const raw = exists ? readFileSync(target, "utf-8") : "";
    const original = raw.startsWith(BOM) ? raw.slice(1) : raw;
    let settings: unknown = {};
    if (original.trim()) {
      try {
        settings = JSON.parse(original);
      } catch {
        // Never overwrite a file the user wrote by hand just because we can't parse it
        skipOnce(label, "is not valid JSON");
        return false;
      }
    }
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      skipOnce(label, "is not a JSON object");
      return false;
    }
    const merge = withExegolHooks(settings as Record<string, unknown>, managed, script);
    if (merge.removed + merge.added === 0) return false;

    const dir = dirname(target);
    const name = basename(target);
    const mode = exists ? statSync(target).mode & 0o777 : 0o644;
    for (const f of readdirSync(dir)) {
      if (f.startsWith(`${name}.exegol-tmp`)) unlinkSync(join(dir, f));
    }
    const backup = join(dir, `${name}.exegol-backup`);
    if (raw && !existsSync(backup)) writeFileSync(backup, raw, { mode: 0o600 });
    // Renamed into place: a CLI starting meanwhile never reads half a file
    const tmp = join(dir, `${name}.exegol-tmp-${process.pid}-${randomBytes(4).toString("hex")}`);
    writeFileSync(tmp, formatLike(raw, merge.settings), { mode: 0o600 });
    chmodSync(tmp, mode);
    renameSync(tmp, target);
    logger.info(
      `[AgentWrappers] ${label}: ${merge.removed} Exegol hook entries removed, ${merge.added} added`,
    );
    return true;
  } catch (err) {
    logger.warn(`[AgentWrappers] Failed to update ${label}:`, err);
    return false;
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
