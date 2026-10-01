import { create } from "zustand";
import type { CloseSummary } from "../lib/close-guard";

/** The one close confirmation on screen, and how to answer it */
interface CloseConfirmStore {
  request: (CloseSummary & { resolve: (ok: boolean) => void }) | null;
  ask: (summary: CloseSummary) => Promise<boolean>;
  answer: (ok: boolean) => void;
}

export const useCloseConfirmStore = create<CloseConfirmStore>()((set, get) => ({
  request: null,
  ask: (summary) =>
    new Promise<boolean>((resolve) => {
      // A second close while one is asking answers the first "no"
      get().request?.resolve(false);
      set({ request: { ...summary, resolve } });
    }),
  answer: (ok) => {
    const req = get().request;
    set({ request: null });
    req?.resolve(ok);
  },
}));
