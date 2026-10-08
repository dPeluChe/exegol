import { type AgentStatus, type DictationTargetKind, LIVE_STATUSES } from "@exegol/shared";
import { ClipboardCopy, FileCode2, Globe, type LucideIcon, TextCursorInput } from "lucide-react";
import { isPasteTarget } from "../agent-input";

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
  /** The pane's session can take dictated text (takesDictation) */
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
  return sameTarget(start, now)
    ? start
    : { kind: "clipboard", projectId: start.projectId, why: "The focus moved while you spoke" };
}

/** A live shell, or an agent that can take pasted text (agent-input). The text is always one
 *  bracketed paste with no Enter for a shell, so it never runs line by line */
export function takesDictation(a: { cliType: string; status: AgentStatus }): boolean {
  return a.cliType === "shell" ? LIVE_STATUSES.has(a.status) : isPasteTarget(a);
}

/** Speech past this is kept on cancel (clipboard): a stray Esc must not lose a long dictation */
export const KEEP_ON_CANCEL_MS = 15_000;

/** The text a cancel copies instead of discarding, null when there is little to lose */
export const keptOnCancel = (speechMs: number, text: string): string | null =>
  speechMs >= KEEP_ON_CANCEL_MS && text ? text : null;

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

/** Non-terminal targets: the overlay chip's icon and name (a terminal shows its agent) */
export const TARGET_KINDS: Record<
  Exclude<DictationTargetKind, "terminal">,
  { name: string; icon: LucideIcon }
> = {
  browser: { name: "Browser", icon: Globe },
  editor: { name: "Editor", icon: FileCode2 },
  field: { name: "This field", icon: TextCursorInput },
  clipboard: { name: "Clipboard", icon: ClipboardCopy },
};

/** A target in words: the agent's alias (else its CLI), "shell", or the kind's name */
export function targetName(
  kind: DictationTargetKind,
  agent?: { alias?: string | null; cliType: string },
): string {
  if (kind !== "terminal") return TARGET_KINDS[kind].name;
  if (!agent) return "the terminal";
  if (agent.cliType === "shell") return "shell";
  return agent.alias || agent.cliType;
}

/** What Insert does, for the overlay */
export function insertHint(kind: DictationTargetKind, name: string, pressEnter: boolean): string {
  switch (kind) {
    case "terminal":
      return `Inserts into ${name} (${pressEnter ? "then presses Enter" : "no Enter sent"})`;
    case "browser":
      return "Inserts into the browser field";
    case "editor":
      return "Inserts at the editor cursor";
    case "field":
      return "Inserts into this field";
    case "clipboard":
      return "Copies to the clipboard";
  }
}
