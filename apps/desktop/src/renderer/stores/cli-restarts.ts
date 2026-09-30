import { create } from "zustand";

/** true: once the turn ends; "now": even mid-turn; "update": once a newer CLI is installed (an
 *  update running in a tab) and the turn ends */
export type RestartWhen = true | "now" | "update";

/** Sessions to restart onto a newer CLI (Suspend + Resume keeps model, YOLO, mode and name) */
interface CliRestartStore {
  pending: Record<string, RestartWhen>;
  request: (agentId: string, when?: RestartWhen) => void;
  cancel: (agentId: string) => void;
}

export const useCliRestartStore = create<CliRestartStore>()((set) => ({
  pending: {},
  request: (agentId, when = true) => set((s) => ({ pending: { ...s.pending, [agentId]: when } })),
  cancel: (agentId) =>
    set((s) => {
      const { [agentId]: _, ...pending } = s.pending;
      return { pending };
    }),
}));
