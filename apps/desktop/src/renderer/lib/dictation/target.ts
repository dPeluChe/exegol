import type { AgentStatus } from "@exegol/shared";

/** Where a dictation goes. Resolved when recording starts and checked again before inserting:
 *  text only lands in the pane (or field) that had the focus all along */
export type DictationTarget =
  | { kind: "terminal"; paneId: string; projectId: string; agentId: string }
  | { kind: "browser"; paneId: string; projectId: string }
  | { kind: "editor"; paneId: string; projectId: string }
  | { kind: "field"; projectId: string | null }
  | { kind: "clipboard"; projectId: string | null; why?: string };

export interface FocusSnapshot {
  activeView: string;
  projectId: string | null;
  focusedPaneId: string | null;
  pane: { id: string; type: string; agentId?: string } | undefined;
  /** The pane's session can take pasted text (agent-input isPasteTarget) */
  sessionLive: boolean;
  /** A text input of the app itself has the focus (address bar, a form) */
  editableField: boolean;
  /** Dashboard: the watched session whose mirror has the focus, with its pane if it has one */
  mirror?: { agentId: string; projectId: string; paneId: string | null; live: boolean };
}

export function resolveTarget(s: FocusSnapshot): DictationTarget {
  const { projectId, pane, mirror } = s;
  if (s.editableField) return { kind: "field", projectId };
  if (s.activeView === "dashboard" && mirror) {
    if (mirror.paneId && mirror.live) {
      const { agentId, paneId } = mirror;
      return { kind: "terminal", paneId, projectId: mirror.projectId, agentId };
    }
    return {
      kind: "clipboard",
      projectId: mirror.projectId,
      why: mirror.live ? "This session has no pane to type into" : "This session is not running",
    };
  }
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

/** A dictation never answers an agent's question: typed text (or its Enter) would pick an
 *  option of a permission dialog */
export function answersPrompt(a: {
  status: AgentStatus;
  dialogOnScreen: boolean;
  awaitingAnswer: boolean;
}): boolean {
  return a.dialogOnScreen || (a.status === "waiting_input" && a.awaitingAnswer);
}

/** Dictated text is data: no escape sequences or control characters reach a terminal (one
 *  could end a bracketed paste and run the rest) */
export function sanitizeDictation(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "").trim();
}
