import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Each open mirror is a live xterm fed every byte of its session; a few is plenty. */
export const MAX_OPEN_MIRRORS = 6;
export const MIN_CARD_FONT = 8;
export const MAX_CARD_FONT = 22;

interface WatchStore {
  /** T194: sessions pinned to the Dashboard, in pin order, across all projects */
  watched: string[];
  /** Mirrors the user opened; attention opens one on its own without landing here */
  open: string[];
  columns: 1 | 2 | 3;
  toggleWatch: (agentId: string) => void;
  toggleOpen: (agentId: string) => void;
  /** Resume spawns a new agent id for the same session; the pin follows it */
  replaceAgent: (oldId: string, newId: string) => void;
  setColumns: (columns: 1 | 2 | 3) => void;
  /** Drag to reorder: put `agentId` right before `beforeId` */
  moveWatched: (agentId: string, beforeId: string) => void;
  /**
   * Cards that size their session: the PTY takes the card's grid at this font,
   * so it reads at a normal size instead of the owner pane's grid shrunk down.
   * Absent = a plain mirror. The pane takes the size back when it is shown.
   */
  cardFont: Record<string, number>;
  setCardFont: (agentId: string, font: number | null) => void;
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
        set((s) => {
          const { [oldId]: font, ...cardFont } = s.cardFont;
          return {
            watched: swap(s.watched, oldId, newId),
            open: swap(s.open, oldId, newId),
            cardFont: font === undefined ? cardFont : { ...cardFont, [newId]: font },
          };
        }),
      cardFont: {},
      setCardFont: (agentId, font) =>
        set((s) => {
          const { [agentId]: _, ...rest } = s.cardFont;
          if (font === null) return { cardFont: rest };
          const clamped = Math.min(MAX_CARD_FONT, Math.max(MIN_CARD_FONT, font));
          return { cardFont: { ...rest, [agentId]: clamped } };
        }),
      setColumns: (columns) => set({ columns }),
      moveWatched: (agentId, beforeId) =>
        set((s) => {
          if (agentId === beforeId || !s.watched.includes(agentId)) return s;
          const rest = s.watched.filter((id) => id !== agentId);
          const at = rest.indexOf(beforeId);
          rest.splice(at === -1 ? rest.length : at, 0, agentId);
          return { watched: rest };
        }),
    }),
    { name: "exegol-watch" },
  ),
);
