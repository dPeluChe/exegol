import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { WindowRect } from "../lib/file-window";
import { focusActivePane } from "../lib/pane-focus";
import { findAgentPane, useAgentStore } from "./agents";
import { useWorkspaceStore } from "./workspace";

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

/** Closes the file window and gives the keyboard back to its session's terminal; false when none
 *  was open */
export function closeFileWindow(): boolean {
  const agentId = useTerminalLinkStore.getState().peek?.agentId;
  if (!closeTerminalPeek()) return false;
  const projectId = agentId ? useAgentStore.getState().agents[agentId]?.projectId : undefined;
  const where = agentId && projectId ? findAgentPane(agentId, projectId) : null;
  if (where && projectId === useWorkspaceStore.getState()._activeProjectId) {
    focusActivePane(where.paneId);
  }
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
