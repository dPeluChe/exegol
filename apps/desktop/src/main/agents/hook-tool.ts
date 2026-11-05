import { broadcast } from "../lib/event-bus";
import { setBounded } from "../lib/set-bounded";

const PUSH_EVERY_MS = 1000;
const MAX_AGENTS = 256;

const TOOL_NAME = /^[A-Za-z0-9_-]{1,80}$/;

interface Pending {
  tool: string;
  timer: NodeJS.Timeout | null;
}

const agents = new Map<string, Pending>();

/** A new turn: the last turn's tool says nothing about this one */
export function clearHookTool(agentId: string): void {
  const state = agents.get(agentId);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  agents.delete(agentId);
  broadcast("agent:activity", { agentId, tool: null });
}

/** A busy turn fires this per tool call: at most one push per second per agent, the last tool.
 *  The renderer keeps only a change of activity */
export function noteHookTool(agentId: string, tool: string | undefined): void {
  if (!tool || !TOOL_NAME.test(tool)) return;
  let state = agents.get(agentId);
  if (!state) {
    state = { tool, timer: null };
    setBounded(agents, agentId, state, MAX_AGENTS);
  }
  state.tool = tool;
  if (state.timer) return;
  const pending = state;
  pending.timer = setTimeout(() => {
    pending.timer = null;
    broadcast("agent:activity", { agentId, tool: pending.tool });
  }, PUSH_EVERY_MS);
  pending.timer.unref?.();
}
