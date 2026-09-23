import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Each open mirror is a live xterm fed every byte of its session; a few is plenty. */
export const MAX_OPEN_MIRRORS = 6;

interface WatchStore {
  /** T194: sessions pinned to the Overview, in pin order, across all projects */
  watched: string[];
  /** Mirrors the user opened; attention opens one on its own without landing here */
  open: string[];
  columns: 1 | 2 | 3;
  toggleWatch: (agentId: string) => void;
  toggleOpen: (agentId: string) => void;
  /** Resume spawns a new agent id for the same session; the pin follows it */
  replaceAgent: (oldId: string, newId: string) => void;
  setColumns: (columns: 1 | 2 | 3) => void;
  /** Drag to reorder: put `agentId` right before `beforeId` (null = at the end) */
  moveWatched: (agentId: string, beforeId: string | null) => void;
}

const pushOpen = (open: string[], id: string) => [...open, id].slice(-MAX_OPEN_MIRRORS);
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
                open: pushOpen(s.open, agentId),
              },
        ),
      toggleOpen: (agentId) =>
        set((s) => ({
          open: s.open.includes(agentId)
            ? s.open.filter((id) => id !== agentId)
            : pushOpen(s.open, agentId),
        })),
      replaceAgent: (oldId, newId) =>
        set((s) => ({ watched: swap(s.watched, oldId, newId), open: swap(s.open, oldId, newId) })),
      setColumns: (columns) => set({ columns }),
      moveWatched: (agentId, beforeId) =>
        set((s) => {
          if (agentId === beforeId || !s.watched.includes(agentId)) return s;
          const rest = s.watched.filter((id) => id !== agentId);
          const at = beforeId ? rest.indexOf(beforeId) : -1;
          rest.splice(at === -1 ? rest.length : at, 0, agentId);
          return { watched: rest };
        }),
    }),
    { name: "exegol-watch" },
  ),
);
