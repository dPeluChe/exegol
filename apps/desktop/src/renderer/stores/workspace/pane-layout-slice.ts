import { projectOfTab, pwOf, setPwOf } from "./helpers";
import type { LayoutNode, WorkspaceSliceCreator, WorkspaceStore } from "./types";

type PaneLayoutSlice = Pick<
  WorkspaceStore,
  "equalizeSplits" | "setSplitSizes" | "setPaneCwd" | "setPaneLastExit"
>;

export const createPaneLayoutSlice: WorkspaceSliceCreator<PaneLayoutSlice> = (set) => ({
  equalizeSplits: (tabId) =>
    set((s) => {
      const pid = projectOfTab(s, tabId);
      const pw = pwOf(s, pid);
      const tab = pw.tabs.find((t) => t.id === tabId);
      if (!tab || tab.layout.type !== "split") return s;

      const equalize = (node: LayoutNode): LayoutNode => {
        if (node.type === "pane") return node;
        const count = node.children.length;
        const equalSize = 100 / count;
        return {
          ...node,
          sizes: node.children.map(() => equalSize),
          children: node.children.map(equalize),
        };
      };

      const newLayout = equalize(tab.layout);
      return setPwOf(s, pid, {
        tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout: newLayout } : t)),
      });
    }),

  setSplitSizes: (tabId, path, sizes) =>
    set((s) => {
      const pid = projectOfTab(s, tabId);
      const pw = pwOf(s, pid);
      const tab = pw.tabs.find((t) => t.id === tabId);
      if (!tab) return s;
      const update = (node: LayoutNode, depth: number): LayoutNode => {
        if (node.type === "pane") return node;
        if (depth === path.length) {
          const same =
            node.sizes.length === sizes.length &&
            node.sizes.every((v, i) => Math.abs(v - (sizes[i] ?? 0)) < 0.1);
          return same ? node : { ...node, sizes };
        }
        const index = path[depth] ?? -1;
        const child = node.children[index];
        if (!child) return node;
        const next = update(child, depth + 1);
        return next === child
          ? node
          : { ...node, children: node.children.map((c, i) => (i === index ? next : c)) };
      };
      const layout = update(tab.layout, 0);
      if (layout === tab.layout) return s;
      return setPwOf(s, pid, { tabs: pw.tabs.map((t) => (t.id === tabId ? { ...t, layout } : t)) });
    }),

  setPaneCwd: (paneId, cwd) =>
    set((s) => {
      if (s.paneCwd[paneId] === cwd) return s;
      return { paneCwd: { ...s.paneCwd, [paneId]: cwd } };
    }),

  setPaneLastExit: (paneId, code) =>
    set((s) => {
      if (s.paneLastExit[paneId] === code) return s;
      return { paneLastExit: { ...s.paneLastExit, [paneId]: code } };
    }),
});
