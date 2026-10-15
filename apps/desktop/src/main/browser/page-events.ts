import { randomUUID } from "node:crypto";
import { ipcMain, type WebContents } from "electron";
import { logger } from "../lib/logger";
import { allowPageClipboard, isUserGesture, originOf } from "./clipboard-policy";
import { getPaneControl, isAgentActing } from "./control";
import {
  addPending,
  answerPending,
  cancelPendingOf,
  decidePageDialog,
  dialogHost,
  dialogNote,
  dropPendingOf,
  getPending,
  isDialogFlood,
  isPageDialogType,
  MAX_DIALOG_TEXT,
  noteDialog,
  pendingCountOf,
  recentDialogs,
} from "./page-dialogs";
import {
  denyPermissionsOf,
  forgetOnce,
  forgetOnceUnless,
  permissionOrigin,
} from "./site-permissions";
import { hostedBy, sendTo } from "./webview-guard";

/** Electron's private event (lib/browser/api/web-contents.ts, Electron 41): its default
 *  listener opens an app-modal message box. If it is renamed, that default simply stays */
const RUN_DIALOG = "-run-dialog";
const CANCEL_DIALOGS = "-cancel-dialogs";
/** Input events that follow an agent's sendInputEvent (browser_press) are not the user's */
const AGENT_INPUT_MS = 1_000;

interface RunDialogInfo {
  frame?: { url?: unknown } | null;
  dialogType?: unknown;
  messageText?: unknown;
  defaultPromptText?: unknown;
}
type DialogCallback = (ok: boolean, text: string) => void;
type DialogListener = (info: RunDialogInfo, callback: DialogCallback) => void;

interface PageState {
  gesture: { at: number; origin: string | null } | null;
  agentInputUntil: number;
  /** Electron's default listeners, for a dialog with no pane to show it */
  native: DialogListener[];
  taken: boolean;
  blocked: boolean;
  recent: number[];
}

const pages = new Map<number, PageState>();
let paneOf: (wcId: number) => string | undefined = () => undefined;

const actingOn = (wcId: number): boolean => {
  const paneId = paneOf(wcId);
  return !!paneId && isAgentActing(paneId);
};

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function stateOf(wcId: number): PageState {
  let s = pages.get(wcId);
  if (!s) {
    s = { gesture: null, agentInputUntil: 0, native: [], taken: false, blocked: false, recent: [] };
    pages.set(wcId, s);
  }
  return s;
}

function onDialog(wc: WebContents, info: RunDialogInfo, callback: DialogCallback): void {
  const type = info?.dialogType;
  if (!isPageDialogType(type) || wc.isDestroyed()) {
    callback(false, "");
    return;
  }
  const state = stateOf(wc.id);
  const paneId = paneOf(wc.id);
  const lastAction = paneId ? (getPaneControl(paneId)?.lastActionAt ?? 0) : 0;
  const decision = decidePageDialog(type, {
    hasPane: !!paneId,
    agentActing: actingOn(wc.id),
    userGestureAfterAgent: (state.gesture?.at ?? 0) > lastAction,
    pendingOnPage: pendingCountOf(wc.id),
    blocked: state.blocked,
  });
  if (decision === "native" || !paneId) {
    for (const fn of state.native) fn(info, callback);
    if (state.native.length === 0) callback(false, "");
    return;
  }
  const host = dialogHost(info.frame?.url ?? wc.getURL());
  // Never the text: it is the page's content
  const how = decision === "show" ? "" : decision === "accept" ? " (dismissed)" : " (cancelled)";
  logger.info(`[Browser] page dialog ${type} on ${host || "(no host)"}${how}`);
  if (decision !== "show") {
    noteDialog(paneId, dialogNote(type, host, decision));
    callback(decision === "accept", "");
    return;
  }
  state.recent = recentDialogs(state.recent, Date.now());
  // Captured now: on teardown hostWebContents is gone, and a stale bar would hide newer ones
  const hostWc = wc.hostWebContents ?? null;
  const id = randomUUID();
  addPending({
    id,
    wcId: wc.id,
    paneId,
    type,
    host,
    answer: callback,
    notifyClosed: () => sendTo(hostWc, "browser:page-dialog-closed", { id }),
  });
  sendTo(hostWc, "browser:page-dialog", {
    id,
    paneId,
    type,
    host,
    message: clip(info.messageText, MAX_DIALOG_TEXT),
    defaultPrompt: clip(info.defaultPromptText, MAX_DIALOG_TEXT),
    offerBlock: isDialogFlood(state.recent),
  });
}

/** Gestures, navigation and teardown of every project webview. Its dialogs stay Electron's
 *  until a pane registers it (`takeOverPageDialogs`). One-time permission grants follow the
 *  page's origin; a new document drops the bars of the old one */
export function trackPageEvents(wc: WebContents): void {
  const id = wc.id;
  const state = stateOf(id);
  (wc as unknown as NodeJS.EventEmitter).on(CANCEL_DIALOGS, () => dropPendingOf(id));
  wc.on("input-event", (_e, input) => {
    if (!isUserGesture(input?.type) || Date.now() < state.agentInputUntil) return;
    state.gesture = { at: Date.now(), origin: originOf(wc.getURL()) };
  });
  wc.on("did-start-navigation", (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    // A new document: no clipboard read off a click on the old one, no block carried over
    state.gesture = null;
    state.blocked = false;
    state.recent = [];
  });
  wc.on("did-navigate", (_e, url) => {
    denyPermissionsOf(id);
    forgetOnceUnless(id, permissionOrigin(url));
  });
  wc.once("destroyed", () => {
    pages.delete(id);
    dropPendingOf(id);
    denyPermissionsOf(id);
    forgetOnce(id);
  });
}

/** A pane registered this webview: its dialogs go to the pane from now on */
export function takeOverPageDialogs(wc: WebContents): void {
  const state = stateOf(wc.id);
  if (state.taken) return;
  state.taken = true;
  const emitter = wc as unknown as NodeJS.EventEmitter;
  state.native = emitter.listeners(RUN_DIALOG) as DialogListener[];
  emitter.removeAllListeners(RUN_DIALOG);
  emitter.on(RUN_DIALOG, (info: RunDialogInfo, callback: DialogCallback) =>
    onDialog(wc, info, callback),
  );
}

/** browser_press is about to send input: those events are no user gesture */
export function markAgentInput(wcId: number): void {
  stateOf(wcId).agentInputUntil = Date.now() + AGENT_INPUT_MS;
}

/** Clipboard permissions of pages in browser panes */
export function pageClipboardDecision(
  wc: WebContents,
  permission: string,
  requestingUrl: string,
): boolean {
  const gesture = pages.get(wc.id)?.gesture ?? null;
  return (
    allowPageClipboard({
      permission,
      agentActing: actingOn(wc.id),
      sinceUserInput: gesture ? Date.now() - gesture.at : null,
      inputOrigin: gesture?.origin ?? null,
      requestOrigin: originOf(requestingUrl),
    }) ?? false
  );
}

/** The pending dialog, when the asking window hosts its webview */
function hostedDialog(sender: WebContents, id: unknown) {
  const d = typeof id === "string" ? getPending(id) : undefined;
  return d && hostedBy(sender, d) ? d : null;
}

export function installPageEvents(lookup: (wcId: number) => string | undefined): void {
  paneOf = lookup;
  ipcMain.handle(
    "browser:page-dialog-answer",
    (event, input: { id?: unknown; ok?: unknown; text?: unknown }) => {
      const d = hostedDialog(event.sender, input?.id);
      return d ? answerPending(d.id, input.ok === true, input.text) : false;
    },
  );
  ipcMain.handle("browser:page-dialog-block", (event, input: { id?: unknown }) => {
    const d = hostedDialog(event.sender, input?.id);
    if (!d) return false;
    stateOf(d.wcId).blocked = true;
    logger.info(`[Browser] page dialogs blocked on ${d.host || "(no host)"}`);
    cancelPendingOf(d.wcId);
    return true;
  });
}
