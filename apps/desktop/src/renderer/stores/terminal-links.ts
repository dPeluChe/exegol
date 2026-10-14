import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { WindowRect } from "../lib/file-window";

/** A file clicked in a terminal, shown read-only in the floating file window (one at a time:
 *  another click replaces it) */
export interface TerminalLinkPeek {
  agentId: string;
  /** As printed: main resolves it against `cwd` (or the agent's own folder) */
  text: string;
  cwd?: string;
  line?: number;
}

export const useTerminalLinkStore = create<{ peek: TerminalLinkPeek | null }>()(() => ({
  peek: null,
}));

export function peekTerminalFile(peek: TerminalLinkPeek): void {
  useTerminalLinkStore.setState({ peek });
}

/** False when nothing was open */
export function closeTerminalPeek(): boolean {
  if (!useTerminalLinkStore.getState().peek) return false;
  useTerminalLinkStore.setState({ peek: null });
  return true;
}

/** Where the user left the file window, kept across restarts; null is the default spot */
export const useFileWindowStore = create<{
  rect: WindowRect | null;
  setRect: (rect: WindowRect) => void;
}>()(
  persist((set) => ({ rect: null, setRect: (rect) => set({ rect }) }), {
    name: "exegol-file-window",
  }),
);
