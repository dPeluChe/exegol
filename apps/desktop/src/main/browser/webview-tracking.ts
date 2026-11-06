import { hostOf, isOutsideAllowlist } from "@exegol/shared";
import { type Session, type WebContents, webContents } from "electron";
import { forgetPane } from "./control";
import { type BrowserLogEntry, LogRing, toLogLevel } from "./log-ring";
import { forgetPaneDialogs } from "./page-dialogs";
import { trackPageEvents } from "./page-events";
import { forgetDictationPage } from "./pane-dictation";
import { agentActingOn, paneHostsOf, removePanesOf } from "./pane-registry";
import { blocksAgentRequest, logUrl } from "./request-guard";

const rings = new Map<number, LogRing>();
const httpStatus = new Map<number, number>();
const projectBySession = new WeakMap<Session, string>();

export const lastHttpStatusOf = (wcId: number): number | null => httpStatus.get(wcId) ?? null;

export function ringOf(wcId: number): LogRing {
  let ring = rings.get(wcId);
  if (!ring) {
    ring = new LogRing();
    rings.set(wcId, ring);
  }
  return ring;
}

export function pageUrlOf(wcId: number): string {
  const wc = webContents.fromId(wcId);
  return wc && !wc.isDestroyed() ? wc.getURL() : "";
}

/** Each entry remembers the host of the page it came from: the tool hides the ones logged while
 *  the pane was on a site outside the project's hosts */
export function pushLog(
  wcId: number,
  entry: Omit<BrowserLogEntry, "seq" | "at">,
  pageUrl?: string,
) {
  const ring = rings.get(wcId);
  if (!ring) return;
  ring.push({ ...entry, page: hostOf(pageUrl ?? pageUrlOf(wcId)) ?? undefined });
}

function pushNetworkLog(
  d: { webContentsId?: number; method: string; url: string },
  detail: { level: BrowserLogEntry["level"]; outcome: string; status?: number },
) {
  if (d.webContentsId === undefined) return;
  const page = pageUrlOf(d.webContentsId);
  const url = logUrl(d.url, hostOf(page));
  pushLog(
    d.webContentsId,
    {
      kind: "network",
      level: detail.level,
      text: `${d.method} ${url} ${detail.outcome}`,
      status: detail.status,
      method: d.method,
      url,
    },
    page,
  );
}

/** Popups and navigations of a project's pages. While an agent drives the pane, nothing may leave
 *  the project's hosts; a popup never opens a window, at most it loads in the same pane */
function guardWebview(wc: WebContents): void {
  const projectOf = () => projectBySession.get(wc.session);
  wc.setWindowOpenHandler(({ url }) => {
    const projectId = projectOf();
    if (projectId && /^https?:/i.test(url) && !isOutsideAllowlist(url, paneHostsOf(projectId))) {
      wc.loadURL(url).catch(() => {});
    } else if (projectId) {
      pushLog(wc.id, {
        kind: "load",
        level: "warning",
        text: "popup blocked",
        url: hostOf(url) ?? "",
      });
    }
    return { action: "deny" };
  });
  wc.on("will-frame-navigate", (event) => {
    const projectId = projectOf();
    if (!projectId || !agentActingOn(projectId, wc.id)) return;
    if (isOutsideAllowlist(event.url, paneHostsOf(projectId))) {
      event.preventDefault();
      pushLog(wc.id, {
        kind: "load",
        level: "error",
        text: `blocked: navigation outside the allowed hosts while an agent drives the pane (${hostOf(event.url)})`,
      });
    }
  });
}

/** Console, uncaught errors and failed loads of every webview, from the moment it exists */
export function trackWebview(wc: WebContents): void {
  const id = wc.id;
  ringOf(id);
  guardWebview(wc);
  trackPageEvents(wc);
  wc.on("console-message", (...args: unknown[]) => {
    const d = args[0] as {
      level?: string;
      message?: string;
      lineNumber?: number;
      sourceId?: string;
    };
    if (typeof d?.message !== "string") return;
    pushLog(id, {
      kind: d.message.startsWith("Uncaught") ? "exception" : "console",
      level: toLogLevel(d.level),
      text: d.message,
      source: d.sourceId || undefined,
      line: d.lineNumber,
    });
  });
  wc.on("did-navigate", (_e, url, code) => {
    httpStatus.set(id, code);
    if (code >= 400) {
      pushLog(
        id,
        { kind: "load", level: "error", text: `page loaded with ${code}`, status: code, url },
        url,
      );
    }
  });
  wc.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    // -3 is an aborted load: a redirect or a new navigation, not a failure
    if (!isMainFrame || code === -3) return;
    pushLog(id, { kind: "load", level: "error", text: `${desc} (${code})`, url }, url);
  });
  wc.once("destroyed", () => {
    rings.delete(id);
    httpStatus.delete(id);
    for (const paneId of removePanesOf(id)) {
      forgetDictationPage(paneId);
      forgetPaneDialogs(paneId);
      forgetPane(paneId);
    }
  });
}

/** Network log and the agent request guard of a project's session (Electron allows one listener
 *  per event and session) */
export function hookSession(ses: Session, projectId: string): void {
  if (projectBySession.has(ses)) return;
  projectBySession.set(ses, projectId);
  ses.webRequest.onBeforeRequest((d, callback) => {
    const acting = agentActingOn(projectId, d.webContentsId);
    const cancel = acting && blocksAgentRequest(d.url, acting, paneHostsOf(projectId));
    if (cancel && d.webContentsId !== undefined) {
      pushNetworkLog(d, { level: "error", outcome: "blocked (outside the allowed hosts)" });
    }
    callback({ cancel });
  });
  ses.webRequest.onCompleted((d) => {
    if (d.statusCode < 400) return;
    pushNetworkLog(d, {
      level: d.statusCode >= 500 ? "error" : "warning",
      outcome: String(d.statusCode),
      status: d.statusCode,
    });
  });
  ses.webRequest.onErrorOccurred((d) => {
    if (d.error === "net::ERR_ABORTED" || d.error === "net::ERR_BLOCKED_BY_CLIENT") return;
    pushNetworkLog(d, { level: "error", outcome: d.error });
  });
}
