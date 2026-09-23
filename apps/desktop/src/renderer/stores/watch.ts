import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Each open mirror is a live xterm with its own WebGL context; Chromium caps those. */
export const MAX_OPEN_MIRRORS = 4;

interface WatchStore {
  /** T194: sessions pinned to the Overview, in pin order, across all projects */
  watched: string[];
  /** Mirrors the user opened; attention opens one on its own without landing here */
  open: string[];
  columns: 1 | 2;
  toggleWatch: (agentId: string) => void;
  toggleOpen: (agentId: string) => void;
  /** Resume spawns a new agent id for the same session; the pin follows it */
  replaceAgent: (oldId: string, newId: string) => void;
  setColumns: (columns: 1 | 2) => void;
}

const swap = (list: string[], oldId: string, newId: string) =>
  list.map((id) => (id === oldId ? newId : id));

export const useWatchStore = create<WatchStore>()(
  persist(
    (set) => ({
      watched: [],
      open: [],
      columns: 1,
      toggleWatch: (agentId) =>
        set((s) =>
          s.watched.includes(agentId)
            ? {
                watched: s.watched.filter((id) => id !== agentId),
                open: s.open.filter((id) => id !== agentId),
              }
            : {
                watched: [...s.watched, agentId],
                open: [...s.open, agentId].slice(-MAX_OPEN_MIRRORS),
              },
        ),
      toggleOpen: (agentId) =>
        set((s) => ({
          open: s.open.includes(agentId)
            ? s.open.filter((id) => id !== agentId)
            : [...s.open, agentId].slice(-MAX_OPEN_MIRRORS),
        })),
      replaceAgent: (oldId, newId) =>
        set((s) => ({ watched: swap(s.watched, oldId, newId), open: swap(s.open, oldId, newId) })),
      setColumns: (columns) => set({ columns }),
    }),
    { name: "exegol-watch" },
  ),
);
