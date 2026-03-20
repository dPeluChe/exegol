// Agent wrapper scripts + lifecycle hook injection for Claude Code and Codex.
// Creates ~/.exegol/hooks/notify.sh for lifecycle event notification.
// Merges hooks into ~/.claude/settings.json and ~/.codex/hooks.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../lib/logger";

const EXEGOL_DIR = join(homedir(), ".exegol");
const HOOKS_DIR = join(EXEGOL_DIR, "hooks");
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

/** Clean up stale event files on app quit. */
export function cleanupAgentWrappers(): void {
  try {
    const { readdirSync, unlinkSync } = require("node:fs") as typeof import("node:fs");
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
echo "{\\"type\\":\\"$EVENT_TYPE\\",\\"agentId\\":\\"$EXEGOL_AGENT_ID\\",\\"ts\\":$TS}" \\
  > "$EVENT_DIR/\${EXEGOL_AGENT_ID}_\${EVENT_TYPE}_\${TS}.json"
`;
  writeFileSync(NOTIFY_SCRIPT, script, { mode: 0o755 });
}

// ─── Shared hook types (Claude Code + Codex use same format) ────────────

interface HookAction {
  type: string;
  command: string;
}

interface HookDef {
  matcher?: string;
  hooks: HookAction[];
}

/** Check if a hook definition was created by Exegol */
function isExegolHook(def: HookDef): boolean {
  return !!def.hooks?.some((h) => h.command?.includes("exegol"));
}

/** Merge managed hooks into an existing settings object (preserves user hooks) */
function mergeHooksIntoSettings(
  settings: Record<string, unknown>,
  events: Array<{ event: string; def: HookDef }>,
): void {
  if (!settings.hooks || typeof settings.hooks !== "object") {
    (settings as Record<string, unknown>).hooks = {};
  }
  const hooks = settings.hooks as Record<string, unknown>;

  for (const { event, def } of events) {
    const existing = hooks[event];
    if (Array.isArray(existing)) {
      const filtered = existing.filter((d: HookDef) => !isExegolHook(d));
      filtered.push(def);
      hooks[event] = filtered;
    } else {
      hooks[event] = [def];
    }
  }
}

// ─── Claude Code Hook Injection ─────────────────────────────────────────

function mergeClaudeHooks(): void {
  if (!existsSync(CLAUDE_SETTINGS)) return;

  try {
    const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf-8"));
    const notifyCmd = `[ -x "${NOTIFY_SCRIPT}" ] && "${NOTIFY_SCRIPT}"`;

    mergeHooksIntoSettings(settings, [
      {
        event: "Stop",
        def: { hooks: [{ type: "command", command: `${notifyCmd} stop` }] },
      },
      {
        event: "PostToolUse",
        def: { matcher: "*", hooks: [{ type: "command", command: `${notifyCmd} tool_use` }] },
      },
      {
        event: "UserPromptSubmit",
        def: { hooks: [{ type: "command", command: `${notifyCmd} prompt_submit` }] },
      },
    ]);

    writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2), "utf-8");
    logger.info("[AgentWrappers] Claude Code hooks merged into settings.json");
  } catch (err) {
    logger.warn("[AgentWrappers] Failed to merge Claude hooks:", err);
  }
}

// ─── Codex Hook Injection ───────────────────────────────────────────────

function mergeCodexHooks(): void {
  const codexDir = join(homedir(), ".codex");
  let settings: Record<string, unknown> = {};

  // Read existing hooks.json if it exists
  if (existsSync(CODEX_HOOKS)) {
    try {
      settings = JSON.parse(readFileSync(CODEX_HOOKS, "utf-8"));
    } catch {
      settings = {};
    }
  }

  const notifyCmd = `[ -x "${NOTIFY_SCRIPT}" ] && "${NOTIFY_SCRIPT}"`;

  // Codex supports SessionStart and Stop events
  mergeHooksIntoSettings(settings, [
    {
      event: "SessionStart",
      def: { hooks: [{ type: "command", command: `${notifyCmd} session_start` }] },
    },
    {
      event: "Stop",
      def: { hooks: [{ type: "command", command: `${notifyCmd} stop` }] },
    },
  ]);

  try {
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(CODEX_HOOKS, JSON.stringify(settings, null, 2), "utf-8");
    logger.info("[AgentWrappers] Codex hooks merged into hooks.json");
  } catch (err) {
    logger.warn("[AgentWrappers] Failed to merge Codex hooks:", err);
  }
}

export function getNotifyScriptPath(): string {
  return NOTIFY_SCRIPT;
}

export function getEventsDir(): string {
  return EVENTS_DIR;
}
