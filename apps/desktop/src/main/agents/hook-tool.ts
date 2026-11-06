import { type DeskActivity, toolActivity } from "@exegol/shared";
import { broadcast } from "../lib/event-bus";
import { setBounded } from "../lib/set-bounded";

const PUSH_EVERY_MS = 1000;
const MAX_AGENTS = 256;

const TOOL_NAME = /^[A-Za-z0-9_-]{1,80}$/;

interface Pending {
  tool: string;
  timer: NodeJS.Timeout | null;
  /** What the renderer was last told */
  pushed: DeskActivity | null;
}

const agents = new Map<string, Pending>();

/** A new turn: the last turn's tool says nothing about this one */
export function clearHookTool(agentId: string): void {
  const state = agents.get(agentId);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  agents.delete(agentId);
  broadcast("agent:activity", { agentId, activity: null });
}

/** A busy turn fires this per tool call: at most one push per second per agent, for the last tool
 *  and only when it changes what the session is doing */
export function noteHookTool(agentId: string, tool: string | undefined): void {
  if (!tool || !TOOL_NAME.test(tool)) return;
  let state = agents.get(agentId);
  if (!state) {
    state = { tool, timer: null, pushed: null };
    setBounded(agents, agentId, state, MAX_AGENTS);
  }
  state.tool = tool;
  if (state.timer) return;
  const pending = state;
  pending.timer = setTimeout(() => {
    pending.timer = null;
    const activity = toolActivity(pending.tool);
    if (activity === pending.pushed) return;
    pending.pushed = activity;
    broadcast("agent:activity", { agentId, activity });
  }, PUSH_EVERY_MS);
  pending.timer.unref?.();
}
