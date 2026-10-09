import { create } from "zustand";

export interface CliSelfUpdate {
  agentId: string;
  projectId: string;
  cliType: string;
  from: string;
  to: string;
}

/** Ended sessions whose CLI updated itself on the way out (main compares versions at exit) */
interface CliSelfUpdateStore {
  byAgent: Record<string, CliSelfUpdate>;
  add: (u: CliSelfUpdate) => void;
}

export const useCliSelfUpdateStore = create<CliSelfUpdateStore>()((set) => ({
  byAgent: {},
  add: (u) => set((s) => ({ byAgent: { ...s.byAgent, [u.agentId]: u } })),
}));
