import type { DeskActivity } from "@exegol/shared";
import { create } from "zustand";

/** What each session's last hook says it does; only Company reads it, so it stays off the agent */
export const useDeskActivityStore = create<{ activity: Record<string, DeskActivity> }>(() => ({
  activity: {},
}));

export function noteDeskActivity(agentId: string, next: DeskActivity | null): void {
  const { activity } = useDeskActivityStore.getState();
  if (activity[agentId] === (next ?? undefined)) return;
  const { [agentId]: _, ...rest } = activity;
  useDeskActivityStore.setState({ activity: next ? { ...rest, [agentId]: next } : rest });
}
