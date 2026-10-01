import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type PageSize, sizeKey } from "../lib/browser-viewports";

/** Sizes the user added to the browser's device picker, kept across restarts */
interface BrowserSizesStore {
  custom: PageSize[];
  add: (size: PageSize) => void;
  remove: (size: PageSize) => void;
}

export const useBrowserSizesStore = create<BrowserSizesStore>()(
  persist(
    (set) => ({
      custom: [],
      add: (size) =>
        set((s) => ({
          custom: [...s.custom.filter((c) => sizeKey(c) !== sizeKey(size)), size],
        })),
      remove: (size) =>
        set((s) => ({ custom: s.custom.filter((c) => sizeKey(c) !== sizeKey(size)) })),
    }),
    { name: "exegol-browser-sizes" },
  ),
);
