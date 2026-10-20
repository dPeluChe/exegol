/** Page dialogs (alert / confirm / prompt) of browser panes: what to do with each, the ones
 *  waiting for the user, and the notes an agent gets about them. No Electron here */

import { createPendingStore, MAX_PENDING_PER_PAGE, type PendingItem } from "./pending-store";

export type PageDialogType = "alert" | "confirm" | "prompt";
/** show: a bar in the pane; accept: alert closed as OK; cancel: confirm false, prompt null;
 *  native: Electron's own box (a webview in no pane) */
export type PageDialogDecision = "native" | "show" | "accept" | "cancel";

export interface PendingPageDialog extends PendingItem {
  paneId: string;
  type: PageDialogType;
  host: string;
  answer: (ok: boolean, text: string) => void;
}

export interface PageDialogContext {
  hasPane: boolean;
  agentActing: boolean;
  /** The user's own click or key on the page came after the agent's last action */
  userGestureAfterAgent: boolean;
  /** Dialogs of this page already waiting in the pane */
  pendingOnPage: number;
  /** The user blocked this page's dialogs (until it navigates) */
  blocked: boolean;
}

const FLOOD_COUNT = 3;
const FLOOD_WINDOW_MS = 30_000;

const MAX_NOTES = 10;
export const MAX_DIALOG_TEXT = 2_000;

const pending = createPendingStore<PendingPageDialog>();
const notes = new Map<string, string[]>();

/** host:port of the asking frame, what the bar and the log show */
export function dialogHost(url: unknown): string {
  if (typeof url !== "string") return "";
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : u.protocol.replace(":", "");
  } catch {
    return "";
  }
}

export const isPageDialogType = (t: unknown): t is PageDialogType =>
  t === "alert" || t === "confirm" || t === "prompt";

const auto = (type: PageDialogType): PageDialogDecision => (type === "alert" ? "accept" : "cancel");

/** An agent driving the pane never waits on a page dialog (alerts close, questions are
 *  cancelled) unless the user just acted on the page themselves */
export function decidePageDialog(type: PageDialogType, c: PageDialogContext): PageDialogDecision {
  if (!c.hasPane) return "native";
  if (c.blocked || c.pendingOnPage >= MAX_PENDING_PER_PAGE) return auto(type);
  if (c.agentActing && !c.userGestureAfterAgent) return auto(type);
  return "show";
}

/** Dialog times of a page within the flood window, `now` included */
export function recentDialogs(times: readonly number[], now: number): number[] {
  return [...times.filter((t) => now - t < FLOOD_WINDOW_MS), now];
}

/** The page keeps opening dialogs: the bar offers to block them */
export const isDialogFlood = (recent: readonly number[]): boolean => recent.length >= FLOOD_COUNT;

/** What Chromium gets back: confirm false / prompt null on cancel */
export function dialogResult(
  type: PageDialogType,
  ok: boolean,
  text: unknown,
): { ok: boolean; text: string } {
  if (type === "alert") return { ok: true, text: "" };
  if (!ok) return { ok: false, text: "" };
  return { ok: true, text: type === "prompt" && typeof text === "string" ? text : "" };
}

export function dialogNote(type: PageDialogType, host: string, decision: PageDialogDecision) {
  const what = `page_dialog: ${type} on ${host || "(no host)"}`;
  return type === "alert" || decision !== "cancel" ? what : `${what} (cancelled)`;
}

export function noteDialog(paneId: string, note: string): void {
  const list = notes.get(paneId) ?? [];
  list.push(note);
  notes.set(paneId, list.slice(-MAX_NOTES));
}

/** The notes since the agent's last tool call on this pane, cleared once read */
export function takeDialogNotes(paneId: string): string[] {
  const list = notes.get(paneId) ?? [];
  notes.delete(paneId);
  return list;
}

/** Adds the notes to a tool result, with a hint when a question went unanswered */
export function withDialogNotes<T>(result: T, list: readonly string[]): T {
  if (list.length === 0 || !result || typeof result !== "object") return result;
  const cancelled = list.some((n) => n.endsWith("(cancelled)"));
  return {
    ...result,
    page_dialogs: list,
    ...(cancelled && {
      page_dialog_hint:
        "The page asked a question while you acted and Exegol cancelled it. If the page needs an answer, call browser_wait_for_user so the user can answer it.",
    }),
  };
}

export function addPending(d: PendingPageDialog): void {
  pending.add(d);
}

export const getPending = (id: string): PendingPageDialog | undefined => pending.get(id);

/** Answers and forgets it; false when it is already gone */
export function answerPending(id: string, ok: boolean, text: unknown, closeBar = false): boolean {
  const d = pending.take(id);
  if (!d) return false;
  const r = dialogResult(d.type, ok, text);
  d.answer(r.ok, r.text);
  if (closeBar) d.notifyClosed();
  return true;
}

/** Chromium cancelled them (navigation, crash) or the webview is gone: no answer goes back */
export function dropPendingOf(wcId: number): PendingPageDialog[] {
  const out = pending.dropOf(wcId);
  for (const d of out) d.notifyClosed();
  return out;
}

/** Answers every dialog of a page as cancelled (the user blocked them) */
export function cancelPendingOf(wcId: number): void {
  for (const d of pending.of(wcId)) answerPending(d.id, false, "", true);
}

export const pendingCountOf = (wcId: number): number => pending.countOf(wcId);

/** The dialog the pane shows: an agent's tool would hang on the blocked page */
export const pendingOnPane = (paneId: string): PendingPageDialog | undefined =>
  pending.find((d) => d.paneId === paneId);

export function forgetPaneDialogs(paneId: string): void {
  notes.delete(paneId);
}

export function pageDialogBlockedResult(paneId: string, d: PendingPageDialog) {
  return {
    status: "page_dialog",
    pane: paneId,
    host: d.host,
    dialog: d.type,
    hint: `The page shows a ${d.type} waiting for the user's answer, and it is blocked until then. Call browser_wait_for_user and ask the user to answer it.`,
  };
}
