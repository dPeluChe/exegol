import { create } from "zustand";

/** A file clicked in a terminal, shown read-only over that session's terminal */
export interface TerminalLinkPeek {
  /** As printed: main resolves it against `cwd` (or the agent's own folder) */
  text: string;
  cwd?: string;
  line?: number;
}

export const useTerminalLinkStore = create<{ peeks: Record<string, TerminalLinkPeek> }>()(() => ({
  peeks: {},
}));

export function peekTerminalFile(agentId: string, peek: TerminalLinkPeek): void {
  useTerminalLinkStore.setState((s) => ({ peeks: { ...s.peeks, [agentId]: peek } }));
}

/** False when nothing was open (Esc goes on to the terminal) */
export function closeTerminalPeek(agentId: string): boolean {
  if (!useTerminalLinkStore.getState().peeks[agentId]) return false;
  useTerminalLinkStore.setState((s) => {
    const { [agentId]: _closed, ...rest } = s.peeks;
    return { peeks: rest };
  });
  return true;
}
