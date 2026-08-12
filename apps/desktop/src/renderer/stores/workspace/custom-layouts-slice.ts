import { nanoid } from "nanoid";
import {
  type CustomLayoutPreset,
  computeCustomPresetTransformation,
  computePresetTransformation,
  getLayoutPreset,
  templateFromLayout,
} from "../../lib/layout-presets";
import { collectPaneIds, getPw, setPw } from "./helpers";
import type { Pane, WorkspaceSliceCreator, WorkspaceStore } from "./types";

export type CustomLayoutsSlice = Pick<
  WorkspaceStore,
  | "customLayouts"
  | "applyLayoutPreset"
  | "applyCustomLayout"
  | "saveCustomLayout"
  | "deleteCustomLayout"
>;

export const createCustomLayoutsSlice: WorkspaceSliceCreator<CustomLayoutsSlice> = (set, get) => ({
  customLayouts: [],

  applyLayoutPreset: (tabId, presetId) => {
    const state = get();
    const pw = getPw(state);
    const tab = pw.tabs.find((t) => t.id === tabId);
    const preset = getLayoutPreset(presetId);
    if (!tab || !preset) return { terminalsToSpawn: [] };

    const existingIds = collectPaneIds(tab.layout);
    const { layout, newPanes, terminalsToSpawn } = computePresetTransformation(preset, existingIds);

    const panesRecord: Record<string, Pane> = { ...pw.panes };
    for (const p of newPanes) panesRecord[p.id] = p;

    set((s) =>
      setPw(s, {
        tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout } : t)),
        panes: panesRecord,
      }),
    );
    return { terminalsToSpawn };
  },

  applyCustomLayout: (tabId, customId) =>
    set((s) => {
      const pw = getPw(s);
      const tab = pw.tabs.find((t) => t.id === tabId);
      const custom = s.customLayouts.find((c) => c.id === customId);
      if (!tab || !custom) return s;

      const existingIds = collectPaneIds(tab.layout);
      const { layout, newPanes } = computeCustomPresetTransformation(custom, existingIds);

      const panesRecord: Record<string, Pane> = { ...pw.panes };
      for (const p of newPanes) panesRecord[p.id] = p;

      return setPw(s, {
        tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout } : t)),
        panes: panesRecord,
      });
    }),

  saveCustomLayout: (tabId, name) => {
    const state = get();
    const pw = getPw(state);
    const tab = pw.tabs.find((t) => t.id === tabId);
    if (!tab) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;

    const { template, slots, slotTypes } = templateFromLayout(tab.layout, pw.panes);
    const custom: CustomLayoutPreset = {
      id: nanoid(8),
      name: trimmed,
      template,
      slots,
      slotTypes,
      createdAt: Date.now(),
    };
    set((s) => ({ customLayouts: [...s.customLayouts, custom] }));
    return custom.id;
  },

  deleteCustomLayout: (customId) =>
    set((s) => ({
      customLayouts: s.customLayouts.filter((c) => c.id !== customId),
    })),
});
