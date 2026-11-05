import { create } from "zustand";

export type DeskActivity = "edits" | "command" | "browser" | "thinking" | "message";

export function toolActivity(tool: string): DeskActivity {
  if (/^(Edit|MultiEdit|Write|NotebookEdit|apply_patch)$/.test(tool)) return "edits";
  if (/^(Bash|shell|exec_command)$/.test(tool)) return "command";
  if (/^(WebFetch|WebSearch)$/.test(tool) || tool.includes("browser_")) return "browser";
  if (tool.endsWith("agent_send")) return "message";
  return "thinking";
}

/** What each session's last hook says it does; only Company reads it, so it stays off the agent */
export const useDeskActivityStore = create<{ activity: Record<string, DeskActivity> }>(() => ({
  activity: {},
}));

/** A busy turn pushes a tool a second: only a new activity reaches the store */
export function noteDeskTool(agentId: string, tool: string | null): void {
  const next = tool ? toolActivity(tool) : undefined;
  const { [agentId]: current, ...rest } = useDeskActivityStore.getState().activity;
  if (current === next) return;
  useDeskActivityStore.setState({ activity: next ? { ...rest, [agentId]: next } : rest });
}
