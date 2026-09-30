import { create } from "zustand";

/** Sessions to restart onto a newer CLI as soon as they are free (not mid-turn) */
interface CliRestartStore {
  /** true: wait for the turn to end; "now": restart even mid-turn */
  pending: Record<string, true | "now">;
  request: (agentId: string, now?: boolean) => void;
  cancel: (agentId: string) => void;
}

export const useCliRestartStore = create<CliRestartStore>()((set) => ({
  pending: {},
  request: (agentId, now) =>
    set((s) => ({ pending: { ...s.pending, [agentId]: now ? "now" : true } })),
  cancel: (agentId) =>
    set((s) => {
      const { [agentId]: _, ...pending } = s.pending;
      return { pending };
    }),
}));
