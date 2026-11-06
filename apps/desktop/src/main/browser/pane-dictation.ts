import { isOutsideAllowlist } from "@exegol/shared";
import { type WebContents, webContents } from "electron";
import { originOf } from "./clipboard-policy";
import { isAgentActing } from "./control";
import {
  AGENT_WORLD_ID,
  ISOLATED_TIMEOUT_MS,
  inProjectPartition,
  isHostedWebview,
  paneById,
  paneHostsOf,
  toolTimeout,
} from "./pane-registry";

/** The page each dictation into a browser pane started on: the text goes nowhere else */
const dictationPages = new Map<string, string>();

export const forgetDictationPage = (paneId: string): void => {
  dictationPages.delete(paneId);
};

/** A pane registered for that project and hosted by the asking window: a renderer cannot reach
 *  another project's page */
function dictationPane(sender: WebContents, paneId: unknown, projectId: unknown) {
  if (typeof paneId !== "string") return null;
  const r = paneById(paneId);
  if (!r || r.projectId !== projectId || isAgentActing(r.paneId)) return null;
  const wc = webContents.fromId(r.wcId);
  if (!isHostedWebview(wc, sender) || !inProjectPartition(wc, r.projectId)) return null;
  return { r, wc };
}

/** The focused element takes typed text and is not a password field (our isolated world) */
const EDITABLE_FOCUS = `(() => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    const textual = ["text", "search", "url", "email", "tel", "number"].includes(type);
    return textual && !el.readOnly && !el.disabled;
  }
  if (tag === "TEXTAREA") return !el.readOnly && !el.disabled;
  return el.isContentEditable === true;
})()`;

/** Dictation started over a browser pane: remember its page */
export function markDictationPage(
  sender: WebContents,
  input: { paneId?: unknown; projectId?: unknown },
): boolean {
  const pane = dictationPane(sender, input.paneId, input.projectId);
  if (!pane) return false;
  dictationPages.set(pane.r.paneId, pane.wc.getURL());
  return true;
}

/** Dictation: types into the focused field of the pane's page, only when it is still the page
 *  the dictation started on, inside the project's hosts, and the field is editable and not a
 *  password. false = the caller copies it instead */
export async function insertTextInBrowserPane(
  sender: WebContents,
  input: { paneId?: unknown; projectId?: unknown; text?: unknown },
): Promise<boolean> {
  const { paneId, projectId, text } = input;
  if (typeof text !== "string" || !text) return false;
  const pane = dictationPane(sender, paneId, projectId);
  if (!pane) return false;
  const { r, wc } = pane;
  const started = dictationPages.get(r.paneId);
  dictationPages.delete(r.paneId);
  const url = wc.getURL();
  if (!started || originOf(started) === null || originOf(started) !== originOf(url)) return false;
  if (!/^https?:/i.test(url) || isOutsideAllowlist(url, paneHostsOf(r.projectId))) return false;
  wc.focus();
  const editable = await toolTimeout(
    wc.executeJavaScriptInIsolatedWorld(AGENT_WORLD_ID, [{ code: EDITABLE_FOCUS }], true),
    ISOLATED_TIMEOUT_MS,
    "The page check",
  ).catch(() => false);
  if (editable !== true || originOf(wc.getURL()) !== originOf(url)) return false;
  await wc.insertText(text);
  return true;
}
