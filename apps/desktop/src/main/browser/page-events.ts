import { randomUUID } from "node:crypto";
import { ipcMain, type WebContents, webContents } from "electron";
import { logger } from "../lib/logger";
import { allowPageClipboard, isUserGesture } from "./clipboard-policy";
import { isAgentActing } from "./control";
import {
  addPending,
  answerPending,
  decidePageDialog,
  dialogHost,
  dialogNote,
  dropPendingOf,
  getPending,
  isPageDialogType,
  MAX_DIALOG_TEXT,
  noteDialog,
} from "./page-dialogs";

/** Electron's private event (lib/browser/api/web-contents.ts, Electron 41): its default
 *  listener opens an app-modal message box. If it is renamed, that default simply stays */
const RUN_DIALOG = "-run-dialog";
const CANCEL_DIALOGS = "-cancel-dialogs";

interface RunDialogInfo {
  frame?: { url?: unknown } | null;
  dialogType?: unknown;
  messageText?: unknown;
  defaultPromptText?: unknown;
}
type DialogCallback = (ok: boolean, text: string) => void;

const lastUserInput = new Map<number, number>();
let paneOf: (wcId: number) => string | undefined = () => undefined;

const actingOn = (wcId: number): boolean => {
  const paneId = paneOf(wcId);
  return !!paneId && isAgentActing(paneId);
};

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function onDialog(wc: WebContents, info: RunDialogInfo, callback: DialogCallback): void {
  const type = info?.dialogType;
  if (!isPageDialogType(type) || wc.isDestroyed()) {
    callback(false, "");
    return;
  }
  const host = dialogHost(info.frame?.url ?? wc.getURL());
  const paneId = paneOf(wc.id);
  const decision = decidePageDialog(type, {
    registered: !!paneId,
    agentActing: actingOn(wc.id),
  });
  // Never the text: it is the page's content
  const how = decision === "show" ? "" : decision === "accept" ? " (dismissed)" : " (cancelled)";
  logger.info(`[Browser] page dialog ${type} on ${host || "(no host)"}${how}`);
  if (!paneId || decision !== "show") {
    if (paneId) noteDialog(paneId, dialogNote(type, host, decision));
    callback(decision === "accept", "");
    return;
  }
  const id = randomUUID();
  addPending({ id, wcId: wc.id, paneId, type, host, answer: callback });
  wc.hostWebContents?.send("browser:page-dialog", {
    id,
    paneId,
    type,
    host,
    message: clip(info.messageText, MAX_DIALOG_TEXT),
    defaultPrompt: clip(info.defaultPromptText, MAX_DIALOG_TEXT),
  });
}

function closeDialogs(wc: WebContents): void {
  const host = wc.isDestroyed() ? null : wc.hostWebContents;
  for (const d of dropPendingOf(wc.id)) {
    if (host && !host.isDestroyed()) host.send("browser:page-dialog-closed", { id: d.id });
  }
}

/** Dialogs answered in the pane, user gestures for the clipboard: every project webview */
export function trackPageEvents(wc: WebContents): void {
  const id = wc.id;
  const emitter = wc as unknown as NodeJS.EventEmitter;
  emitter.removeAllListeners(RUN_DIALOG);
  emitter.on(RUN_DIALOG, (info: RunDialogInfo, callback: DialogCallback) =>
    onDialog(wc, info, callback),
  );
  emitter.on(CANCEL_DIALOGS, () => closeDialogs(wc));
  wc.on("input-event", (_e, input) => {
    // Input the agent sends (browser_press) is no user gesture
    if (isUserGesture(input?.type) && !actingOn(id)) lastUserInput.set(id, Date.now());
  });
  wc.once("destroyed", () => {
    lastUserInput.delete(id);
    dropPendingOf(id);
  });
}

/** Clipboard permissions of pages in browser panes; null for anything else */
export function pageClipboardDecision(wc: WebContents | null, permission: string): boolean | null {
  if (!wc || wc.isDestroyed() || wc.getType() !== "webview") return null;
  const last = lastUserInput.get(wc.id);
  return allowPageClipboard({
    permission,
    agentActing: actingOn(wc.id),
    sinceUserInput: last === undefined ? null : Date.now() - last,
  });
}

export function installPageEvents(lookup: (wcId: number) => string | undefined): void {
  paneOf = lookup;
  ipcMain.handle(
    "browser:page-dialog-answer",
    (event, input: { id?: unknown; ok?: unknown; text?: unknown }) => {
      if (typeof input?.id !== "string") return false;
      const d = getPending(input.id);
      const wc = d ? webContents.fromId(d.wcId) : undefined;
      // Only the window that hosts the page answers its dialog
      if (!d || !wc || wc.isDestroyed() || wc.hostWebContents !== event.sender) return false;
      return answerPending(input.id, input.ok === true, input.text);
    },
  );
}
