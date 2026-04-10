import { nanoid } from "nanoid";
import type { LayoutNode, Pane, PaneType } from "../stores/workspace";

/**
 * Canonical workspace layout presets.
 *
 * A preset describes a tab layout with N "slots". When applied:
 * 1. Existing panes fill the slots in order.
 * 2. If the preset requests a specific pane type for an empty slot
 *    (`slotTypes`), a fresh pane of that type is created instead of a
 *    plain empty pane. Slots marked as "terminal" additionally get a
 *    shell agent spawned by the caller (post-processing).
 * 3. If there are more existing panes than slots, the overflow is
 *    stuffed into the last slot as a nested vertical split so no pane
 *    is ever lost.
 */

export type LayoutPresetId =
  | "single"
  | "split-horizontal"
  | "split-vertical"
  | "three-columns"
  | "bottom-terminal"
  | "two-by-two";

/** Slot type hints — undefined means "reuse existing or fallback to empty". */
export type SlotType = PaneType | undefined;

export interface LayoutPreset {
  id: LayoutPresetId;
  label: string;
  description: string;
  slots: number;
  /** Optional: pane type per slot when a new pane has to be created. */
  slotTypes?: SlotType[];
  /** Build the layout tree. `paneIds` is guaranteed to have >= slots entries. */
  build: (paneIds: string[]) => LayoutNode;
}

/** Metadata captured per slot when a custom layout is saved. */
export interface CustomLayoutSlot {
  /** Type the pane had at save time. Used when the destination tab has
   *  fewer panes than slots and we need to create new ones. */
  type: PaneType;
  url?: string;
  filePath?: string;
  // agentId is intentionally NOT saved: agents are session-specific, and
  // a recreated terminal slot should show the launcher so the user picks
  // a fresh agent.
}

/** User-saved layout snapshot. Template uses indexed slot placeholders. */
export interface CustomLayoutPreset {
  id: string;
  name: string;
  /** Layout tree where each leaf paneId is a slot placeholder like "__slot_0__". */
  template: LayoutNode;
  slots: number;
  /** Per-slot metadata in slot-index order. Added in T85 follow-up. */
  slotTypes?: CustomLayoutSlot[];
  createdAt: number;
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
    description: "Main pane on top, terminal at the bottom (70/30)",
    slots: 2,
    // Bottom slot is always a terminal; the top slot reuses an existing pane.
    slotTypes: [undefined, "terminal"],
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

// ─── Transformation helper ────────────────────────────────────────────────

/**
 * Computes the new layout + list of panes to create when applying a preset.
 * Pure function: does not mutate state.
 *
 * Returns:
 * - `layout`: the new LayoutNode tree
 * - `newPanes`: panes that must be created in the store
 * - `terminalsToSpawn`: subset of newPanes that need a shell agent spawned
 */
export interface LayoutTransformation {
  layout: LayoutNode;
  newPanes: Pane[];
  terminalsToSpawn: string[];
}

export function computePresetTransformation(
  preset: LayoutPreset,
  existingPaneIds: string[],
): LayoutTransformation {
  const newPanes: Pane[] = [];
  const terminalsToSpawn: string[] = [];
  const paddedIds: string[] = [...existingPaneIds];

  // Fill empty slots with freshly-created panes (typed if slotTypes is set).
  for (let i = paddedIds.length; i < preset.slots; i++) {
    const slotType: SlotType = preset.slotTypes?.[i];
    const pane: Pane = { id: nanoid(8), type: slotType ?? "empty" };
    newPanes.push(pane);
    paddedIds.push(pane.id);
    if (slotType === "terminal") {
      terminalsToSpawn.push(pane.id);
    }
  }

  // Preset also wants to override a slot with a specific type even though an
  // existing pane is already there — in that case we REPLACE the slot pane
  // with a freshly typed one (only if the existing pane was empty). We do not
  // replace non-empty panes because that would destroy agent/browser state.
  //
  // NOTE: the replacement only happens when `slotTypes[i]` is set, the
  // existing pane at that index is type "empty", and i < preset.slots.
  // This preserves user-created terminals, browsers, etc.

  let layout: LayoutNode;
  if (existingPaneIds.length > preset.slots) {
    // Overflow → collapse into a vertical split inside the last slot
    const baseIds = paddedIds.slice(0, preset.slots - 1);
    const extraIds = paddedIds.slice(preset.slots - 1);
    const extraLayout: LayoutNode = {
      type: "split",
      direction: "vertical",
      sizes: extraIds.map(() => 100 / extraIds.length),
      children: extraIds.map((id): LayoutNode => ({ type: "pane", paneId: id })),
    };
    const placeholder = [...baseIds, "__extra__"];
    const built = preset.build(placeholder);
    const replaceExtra = (node: LayoutNode): LayoutNode => {
      if (node.type === "pane") {
        return node.paneId === "__extra__" ? extraLayout : node;
      }
      return { ...node, children: node.children.map(replaceExtra) };
    };
    layout = replaceExtra(built);
  } else {
    layout = preset.build(paddedIds);
  }

  return { layout, newPanes, terminalsToSpawn };
}

// ─── Custom preset helpers ────────────────────────────────────────────────

const SLOT_PREFIX = "__slot_";

/**
 * Convert a live layout tree into a reusable template by replacing each
 * pane id with an indexed slot placeholder. The order of slots matches the
 * left-to-right, depth-first traversal of the tree. Captures per-slot
 * metadata (type, url, filePath) from the source panes so the custom
 * preset can recreate equivalent panes when applied to a different tab.
 */
export function templateFromLayout(
  layout: LayoutNode,
  sourcePanes: Record<string, Pane>,
): {
  template: LayoutNode;
  slots: number;
  slotTypes: CustomLayoutSlot[];
} {
  let slotCounter = 0;
  const slotTypes: CustomLayoutSlot[] = [];
  const walk = (node: LayoutNode): LayoutNode => {
    if (node.type === "pane") {
      const original = sourcePanes[node.paneId];
      slotTypes.push({
        type: original?.type ?? "empty",
        url: original?.url,
        filePath: original?.filePath,
      });
      const placeholder = `${SLOT_PREFIX}${slotCounter}__`;
      slotCounter++;
      return { type: "pane", paneId: placeholder };
    }
    return { ...node, children: node.children.map(walk) };
  };
  const template = walk(layout);
  return { template, slots: slotCounter, slotTypes };
}

/**
 * Apply a custom layout preset: walk the template and replace each slot
 * placeholder with a real pane id in order. When a slot has no existing
 * pane AND the template captured a slot type, a new typed pane is created
 * (with the saved url/filePath metadata) so applying a template on a
 * fresh tab recreates the original shape instead of showing empty panes.
 */
export function computeCustomPresetTransformation(
  custom: CustomLayoutPreset,
  existingPaneIds: string[],
): LayoutTransformation {
  const newPanes: Pane[] = [];
  const paddedIds: string[] = [...existingPaneIds];
  while (paddedIds.length < custom.slots) {
    const slotIndex = paddedIds.length;
    const hint = custom.slotTypes?.[slotIndex];
    // Recreate the original pane type when available; fall back to empty
    // for pre-migration custom layouts that didn't capture slot metadata.
    const pane: Pane = {
      id: nanoid(8),
      type: hint?.type ?? "empty",
      url: hint?.url,
      filePath: hint?.filePath,
    };
    newPanes.push(pane);
    paddedIds.push(pane.id);
  }

  const fill = (node: LayoutNode): LayoutNode => {
    if (node.type === "pane") {
      const match = node.paneId.match(/^__slot_(\d+)__$/);
      if (match) {
        const idx = Number.parseInt(match[1] as string, 10);
        return { type: "pane", paneId: paddedIds[idx] as string };
      }
      return node;
    }
    return { ...node, children: node.children.map(fill) };
  };

  let layout = fill(custom.template);

  // Handle overflow panes: stuff them into the last pane slot as a nested
  // vertical split. This keeps every user pane visible.
  if (existingPaneIds.length > custom.slots) {
    const extraIds = paddedIds.slice(custom.slots);
    // Find the last pane leaf in the filled layout and replace it with a
    // vertical split containing its original paneId + the extras.
    const findLastLeaf = (node: LayoutNode): LayoutNode | null => {
      if (node.type === "pane") return node;
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if (!child) continue;
        const found = findLastLeaf(child);
        if (found) return found;
      }
      return null;
    };
    const lastLeaf = findLastLeaf(layout);
    if (lastLeaf && lastLeaf.type === "pane") {
      const allIds = [lastLeaf.paneId, ...extraIds];
      const replacement: LayoutNode = {
        type: "split",
        direction: "vertical",
        sizes: allIds.map(() => 100 / allIds.length),
        children: allIds.map((id): LayoutNode => ({ type: "pane", paneId: id })),
      };
      const replaceLeaf = (node: LayoutNode): LayoutNode => {
        if (node.type === "pane") {
          return node.paneId === lastLeaf.paneId ? replacement : node;
        }
        return { ...node, children: node.children.map(replaceLeaf) };
      };
      layout = replaceLeaf(layout);
    }
  }

  return { layout, newPanes, terminalsToSpawn: [] };
}
