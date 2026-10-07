import type { DictationTargetKind } from "@exegol/shared";

/** Where a dictation goes. Resolved when recording starts and checked again before inserting:
 *  text only lands in the pane (or field) that had the focus all along */
export type DictationTarget =
  | { kind: "terminal"; paneId: string; projectId: string; agentId: string }
  | { kind: "browser"; paneId: string; projectId: string }
  | { kind: "editor"; paneId: string; projectId: string }
  | { kind: "field"; projectId: string | null }
  | { kind: "clipboard"; projectId: string | null };

export interface FocusSnapshot {
  activeView: string;
  projectId: string | null;
  focusedPaneId: string | null;
  pane: { id: string; type: string; agentId?: string } | undefined;
  /** The pane's session can take input */
  sessionLive: boolean;
  /** A text input of the app itself has the focus (address bar, a form) */
  editableField: boolean;
}

export function resolveTarget(s: FocusSnapshot): DictationTarget {
  const { projectId, pane } = s;
  if (s.editableField) return { kind: "field", projectId };
  if (s.activeView !== "workspace" || !projectId || !pane || pane.id !== s.focusedPaneId) {
    return { kind: "clipboard", projectId };
  }
  if (pane.type === "terminal" && pane.agentId && s.sessionLive) {
    return { kind: "terminal", paneId: pane.id, projectId, agentId: pane.agentId };
  }
  if (pane.type === "browser") return { kind: "browser", paneId: pane.id, projectId };
  if (pane.type === "files") return { kind: "editor", paneId: pane.id, projectId };
  return { kind: "clipboard", projectId };
}

const sameTarget = (a: DictationTarget, b: DictationTarget): boolean =>
  a.kind === b.kind &&
  a.projectId === b.projectId &&
  ("paneId" in a ? "paneId" in b && a.paneId === b.paneId : true) &&
  ("agentId" in a ? "agentId" in b && a.agentId === b.agentId : true);

/** The start target if the focus is still there, else the clipboard */
export function confirmTarget(start: DictationTarget, now: DictationTarget): DictationTarget {
  return sameTarget(start, now) ? start : { kind: "clipboard", projectId: start.projectId };
}

export const targetKind = (t: DictationTarget): DictationTargetKind => t.kind;

/** Dictated text is data: no escape sequences or control characters reach a terminal (one
 *  could end a bracketed paste and run the rest) */
export function sanitizeDictation(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "").trim();
}
