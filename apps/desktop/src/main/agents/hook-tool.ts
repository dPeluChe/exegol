import { broadcast } from "../lib/event-bus";

const PUSH_EVERY_MS = 1000;
const MAX_AGENTS = 256;

const TOOL_NAME = /^[A-Za-z0-9_-]{1,80}$/;

interface Pending {
  tool: string;
  timer: NodeJS.Timeout | null;
  sent: string | null;
}

const agents = new Map<string, Pending>();

/** A busy turn fires this per tool call: at most one push per second per agent, the last tool */
export function noteHookTool(agentId: string, tool: string | undefined): void {
  if (!tool || !TOOL_NAME.test(tool)) return;
  let state = agents.get(agentId);
  if (!state) {
    state = { tool, timer: null, sent: null };
    agents.set(agentId, state);
    if (agents.size > MAX_AGENTS) {
      const oldest = agents.keys().next().value;
      if (oldest !== undefined) agents.delete(oldest);
    }
  }
  state.tool = tool;
  if (state.timer || state.sent === tool) return;
  const pending = state;
  pending.timer = setTimeout(() => {
    pending.timer = null;
    pending.sent = pending.tool;
    broadcast("agent:activity", { agentId, tool: pending.tool });
  }, PUSH_EVERY_MS);
  pending.timer.unref?.();
}
