import type { LayoutNode } from "../stores/workspace";

/**
 * Canonical workspace layout presets.
 *
 * A preset is defined as a list of "slots": placeholder pane indices that will
 * be filled with the tab's existing panes (in order), plus a function that
 * builds the layout tree given an array of pane IDs.
 */

export type LayoutPresetId =
  | "single"
  | "split-horizontal"
  | "split-vertical"
  | "three-columns"
  | "bottom-terminal"
  | "two-by-two";

export interface LayoutPreset {
  id: LayoutPresetId;
  label: string;
  description: string;
  /** Number of pane slots this layout occupies. */
  slots: number;
  /** Build the layout tree. `paneIds` is guaranteed to have >= slots entries. */
  build: (paneIds: string[]) => LayoutNode;
}

const paneLeaf = (paneId: string): LayoutNode => ({ type: "pane", paneId });

const equalSizes = (count: number): number[] => Array.from({ length: count }, () => 100 / count);

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: "single",
    label: "Single",
    description: "One pane full size",
    slots: 1,
    build: (ids) => paneLeaf(ids[0] as string),
  },
  {
    id: "split-horizontal",
    label: "Split Horizontal",
    description: "Two panes side by side",
    slots: 2,
    build: (ids) => ({
      type: "split",
      direction: "horizontal",
      sizes: equalSizes(2),
      children: [paneLeaf(ids[0] as string), paneLeaf(ids[1] as string)],
    }),
  },
  {
    id: "split-vertical",
    label: "Split Vertical",
    description: "Two panes stacked",
    slots: 2,
    build: (ids) => ({
      type: "split",
      direction: "vertical",
      sizes: equalSizes(2),
      children: [paneLeaf(ids[0] as string), paneLeaf(ids[1] as string)],
    }),
  },
  {
    id: "three-columns",
    label: "Three Columns",
    description: "Three panes in a row",
    slots: 3,
    build: (ids) => ({
      type: "split",
      direction: "horizontal",
      sizes: equalSizes(3),
      children: [
        paneLeaf(ids[0] as string),
        paneLeaf(ids[1] as string),
        paneLeaf(ids[2] as string),
      ],
    }),
  },
  {
    id: "bottom-terminal",
    label: "Bottom Terminal",
    description: "Main pane on top (70%), secondary at bottom (30%)",
    slots: 2,
    build: (ids) => ({
      type: "split",
      direction: "vertical",
      sizes: [70, 30],
      children: [paneLeaf(ids[0] as string), paneLeaf(ids[1] as string)],
    }),
  },
  {
    id: "two-by-two",
    label: "2×2 Grid",
    description: "Four panes in a grid",
    slots: 4,
    build: (ids) => ({
      type: "split",
      direction: "vertical",
      sizes: equalSizes(2),
      children: [
        {
          type: "split",
          direction: "horizontal",
          sizes: equalSizes(2),
          children: [paneLeaf(ids[0] as string), paneLeaf(ids[1] as string)],
        },
        {
          type: "split",
          direction: "horizontal",
          sizes: equalSizes(2),
          children: [paneLeaf(ids[2] as string), paneLeaf(ids[3] as string)],
        },
      ],
    }),
  },
];

export function getLayoutPreset(id: LayoutPresetId): LayoutPreset | undefined {
  return LAYOUT_PRESETS.find((p) => p.id === id);
}
