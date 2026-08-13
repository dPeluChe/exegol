import { nanoid } from "nanoid";
import type { LayoutNode, Pane, ProjectWorkspace, WorkspaceStore } from "./types";

// ─── Helpers ────────────────────────────────────────────────────────────────

export function createEmptyPane(): Pane {
  return { id: nanoid(8), type: "empty" };
}

const EMPTY_PW: ProjectWorkspace = { tabs: [], activeTabId: null, panes: {} };

export function getPw(state: WorkspaceStore): ProjectWorkspace {
  const pid = state._activeProjectId;
  if (!pid) return EMPTY_PW;
  return state.projectWorkspaces[pid] ?? EMPTY_PW;
}

export function setPw(
  state: WorkspaceStore,
  updates: Partial<ProjectWorkspace>,
): Partial<WorkspaceStore> {
  const pid = state._activeProjectId;
  if (!pid) return {};
  const current = state.projectWorkspaces[pid] ?? EMPTY_PW;
  return {
    projectWorkspaces: {
      ...state.projectWorkspaces,
      [pid]: { ...current, ...updates },
    },
  };
}

export function removeNodeByPaneId(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === "pane") {
    return node.paneId === paneId ? null : node;
  }

  const remaining: LayoutNode[] = [];
  const remainingSizes: number[] = [];
  for (let i = 0; i < node.children.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: layout tree guarantees non-null
    const child = node.children[i]!;
    const kept = removeNodeByPaneId(child, paneId);
    if (kept) {
      remaining.push(kept);
      remainingSizes.push(node.sizes[i] ?? 50);
    }
  }

  if (remaining.length === 0) return null;
  // biome-ignore lint/style/noNonNullAssertion: layout tree guarantees non-null
  if (remaining.length === 1) return remaining[0]!;

  const total = remainingSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes = remainingSizes.map((s) =>
    total > 0 ? (s / total) * 100 : 100 / remainingSizes.length,
  );

  return { ...node, children: remaining, sizes: normalizedSizes };
}

export function findFirstPaneId(node: LayoutNode): string | null {
  if (node.type === "pane") return node.paneId;
  for (const child of node.children) {
    const found = findFirstPaneId(child);
    if (found) return found;
  }
  return null;
}

export function splitNodeByPaneId(
  node: LayoutNode,
  paneId: string,
  direction: "horizontal" | "vertical",
  newPaneId: string,
  /** Place the new pane BEFORE the target (drop on its left/top edge). */
  newPaneFirst = false,
): LayoutNode {
  if (node.type === "pane") {
    if (node.paneId === paneId) {
      const incoming: LayoutNode = { type: "pane", paneId: newPaneId };
      return {
        type: "split",
        direction,
        children: newPaneFirst ? [incoming, node] : [node, incoming],
        sizes: [50, 50],
      };
    }
    return node;
  }

  const newChildren = node.children.map((child) =>
    splitNodeByPaneId(child, paneId, direction, newPaneId, newPaneFirst),
  );
  const changed = newChildren.some((c, i) => c !== node.children[i]);
  return changed ? { ...node, children: newChildren } : node;
}

export function collectPaneIds(node: LayoutNode): string[] {
  if (node.type === "pane") return [node.paneId];
  return node.children.flatMap(collectPaneIds);
}
