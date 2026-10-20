import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Offset } from "../lib/dictation/overlay-position";

/** What the dragged card is placed relative to: the target pane, or the window */
export type AnchorKind = "pane" | "window";

/** Where the user dragged the dictation card, per anchor kind, kept across restarts; none =
 *  centered. v1 stores fractions of the anchor (v0 px offsets reset to center) */
interface DictationOverlayStore {
  offsets: Partial<Record<AnchorKind, Offset>>;
  setOffset: (kind: AnchorKind, offset: Offset | null) => void;
}

export const useDictationOverlayStore = create<DictationOverlayStore>()(
  persist(
    (set) => ({
      offsets: {},
      setOffset: (kind, offset) =>
        set((s) => {
          const offsets = { ...s.offsets };
          if (offset) offsets[kind] = offset;
          else delete offsets[kind];
          return { offsets };
        }),
    }),
    { name: "exegol-dictation-overlay", version: 1, migrate: () => ({ offsets: {} }) },
  ),
);
