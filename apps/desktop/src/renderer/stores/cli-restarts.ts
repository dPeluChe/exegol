import { create } from "zustand";

/** true: once the turn ends; "now": even mid-turn; "update": once a newer CLI is installed (an
 *  update running in a shell) and the turn ends */
export type RestartWhen = true | "now" | "update";

/** The update a pending "update" waits on: the shell running it, and when that shell ended */
export interface UpdateRun {
  startedAt: number;
  shellId: string | null;
  shellEndedAt?: number;
}

/** No newer version 10 min after the start, or 30 s after the update's shell ended (the last
 *  version check runs meanwhile): the update did not install one */
const UPDATE_MAX_MS = 10 * 60 * 1000;
const AFTER_SHELL_MS = 30_000;

export function updateGaveUp(run: UpdateRun | undefined, now: number): boolean {
  if (!run) return false;
  if (now - run.startedAt > UPDATE_MAX_MS) return true;
  return run.shellEndedAt !== undefined && now - run.shellEndedAt > AFTER_SHELL_MS;
}

/** Sessions to restart onto a newer CLI (Suspend + Resume keeps model, YOLO, mode and name) */
interface CliRestartStore {
  pending: Record<string, RestartWhen>;
  updates: Record<string, UpdateRun>;
  request: (agentId: string, when?: RestartWhen) => void;
  /** These "update" restarts wait on the shell `shellId` runs the update in */
  watchUpdate: (agentIds: string[], shellId: string | null) => void;
  shellEnded: (agentId: string, at: number) => void;
  cancel: (agentId: string) => void;
}

export const useCliRestartStore = create<CliRestartStore>()((set) => ({
  pending: {},
  updates: {},
  request: (agentId, when = true) => set((s) => ({ pending: { ...s.pending, [agentId]: when } })),
  watchUpdate: (agentIds, shellId) =>
    set((s) => {
      const updates = { ...s.updates };
      for (const id of agentIds) updates[id] = { startedAt: Date.now(), shellId };
      return { updates };
    }),
  shellEnded: (agentId, at) =>
    set((s) => {
      const run = s.updates[agentId];
      return run ? { updates: { ...s.updates, [agentId]: { ...run, shellEndedAt: at } } } : {};
    }),
  cancel: (agentId) =>
    set((s) => {
      const { [agentId]: _, ...pending } = s.pending;
      const { [agentId]: __, ...updates } = s.updates;
      return { pending, updates };
    }),
}));
