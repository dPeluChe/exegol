import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Cmd+1 is the Dashboard: projects answer to these, in this order */
export const SHORTCUT_DIGITS = ["2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;
export type ShortcutDigit = (typeof SHORTCUT_DIGITS)[number];

interface ShortcutStore {
  /** Numbers the user gave a project (Edit project): kept whatever else happens */
  assigned: Record<string, ShortcutDigit>;
  /** One project per number: giving it to a project takes it from the one that had it */
  assign: (projectId: string, digit: ShortcutDigit | null) => void;
}

export const useShortcutStore = create<ShortcutStore>()(
  persist(
    (set) => ({
      assigned: {},
      assign: (projectId, digit) =>
        set((s) => {
          const assigned = Object.fromEntries(
            Object.entries(s.assigned).filter(([id, d]) => id !== projectId && d !== digit),
          ) as Record<string, ShortcutDigit>;
          if (digit) assigned[projectId] = digit;
          return { assigned };
        }),
    }),
    { name: "exegol-shortcuts" },
  ),
);
