import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Each open mirror is a live xterm fed every byte of its session; a few is plenty. */
export const MAX_OPEN_MIRRORS = 6;
const MIN_CARD_FONT = 8;
const MAX_CARD_FONT = 22;
/** Where A−/A+ and "fit session to card" start from */
export const DEFAULT_CARD_FONT = 13;

interface WatchStore {
  /** T194: sessions pinned to the Dashboard, in pin order, across all projects */
  watched: string[];
  /** Mirrors the user opened; attention opens one on its own without landing here */
  open: string[];
  columns: 1 | 2 | 3;
  toggleWatch: (agentId: string) => void;
  /** The session is gone (closed): drop its pin, open state and font */
  unwatch: (agentId: string) => void;
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
const omit = (fonts: Record<string, number>, id: string) => {
  const { [id]: _, ...rest } = fonts;
  return rest;
};
const swap = (list: string[], oldId: string, newId: string) =>
  list.map((id) => (id === oldId ? newId : id));

/** 0.5.8 pinned every session sized to its card; that was the default, not a choice */
export function migrateWatchStore(persisted: unknown, version: number) {
  return version < 1 && persisted && typeof persisted === "object"
    ? { ...(persisted as object), cardFont: {} }
    : persisted;
}

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
                cardFont: omit(s.cardFont, agentId),
              }
            : {
                // A plain mirror: sizing the session to the card changes the PTY's width, and
                // Claude's inline redraw then overlaps lines each time the view switches
                watched: [...s.watched, agentId],
                open: pushOpen(s.open, agentId),
              },
        ),
      unwatch: (agentId) =>
        set((s) =>
          s.watched.includes(agentId)
            ? {
                watched: s.watched.filter((id) => id !== agentId),
                open: s.open.filter((id) => id !== agentId),
                cardFont: omit(s.cardFont, agentId),
              }
            : s,
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
          const rest = omit(s.cardFont, agentId);
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
    {
      name: "exegol-watch",
      version: 1,
      migrate: migrateWatchStore,
    },
  ),
);
