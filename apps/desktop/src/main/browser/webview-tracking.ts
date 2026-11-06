import { hostOf, isOutsideAllowlist } from "@exegol/shared";
import { type Session, type WebContents, webContents } from "electron";
import { forgetPane } from "./control";
import { freshLoad, LOAD_BUDGET_MS, type PageLoad, shouldStopLoad } from "./load-state";
import { type BrowserLogEntry, LogRing, toLogLevel } from "./log-ring";
import { forgetPaneDialogs } from "./page-dialogs";
import { trackPageEvents } from "./page-events";
import { forgetDictationPage } from "./pane-dictation";
import { agentActingOn, paneHostsOf, removePanesOf } from "./pane-registry";
import { blocksAgentRequest, logUrl } from "./request-guard";

const rings = new Map<number, LogRing>();
const httpStatus = new Map<number, number>();
const loads = new Map<number, PageLoad>();
const projectBySession = new WeakMap<Session, string>();

export const lastHttpStatusOf = (wcId: number): number | null => httpStatus.get(wcId) ?? null;

export const loadOf = (wcId: number): PageLoad => loads.get(wcId) ?? freshLoad(Date.now());

const updateLoad = (wcId: number, change: Partial<PageLoad>): void => {
  loads.set(wcId, { ...loadOf(wcId), ...change });
};

/** Electron holds page scripts until the main frame finishes, so a resource that never answers
 *  would hang every tool on the pane: past the budget the load is stopped (see shouldStopLoad).
 *  True when it goes on regardless, for a server that has not answered yet */
export async function awaitPageLoad(wc: WebContents): Promise<boolean> {
  if (wc.isDestroyed() || !wc.isLoadingMainFrame()) return false;
  const left = loadOf(wc.id).startedAt + LOAD_BUDGET_MS - Date.now();
  if (left > 0) {
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        wc.off("did-stop-loading", finish);
        wc.off("destroyed", finish);
        resolve();
      };
      const timer = setTimeout(finish, left);
      wc.once("did-stop-loading", finish);
      wc.once("destroyed", finish);
    });
  }
  if (wc.isDestroyed() || !wc.isLoadingMainFrame()) return false;
  if (!shouldStopLoad(loadOf(wc.id), Date.now())) return true;
  updateLoad(wc.id, { stopped: true });
  pushLog(wc.id, {
    kind: "load",
    level: "error",
    text: `load stopped after ${LOAD_BUDGET_MS / 1000} s: a resource never finished`,
  });
  wc.stop();
  return false;
}

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
function pushLog(wcId: number, entry: Omit<BrowserLogEntry, "seq" | "at">, pageUrl?: string) {
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
        level: "error",
        text: "popup blocked: it leads outside the allowed hosts",
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
  wc.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) loads.set(id, freshLoad(Date.now()));
  });
  wc.on("dom-ready", () => updateLoad(id, { domReady: true }));
  wc.on("did-navigate", (_e, url, code) => {
    httpStatus.set(id, code);
    updateLoad(id, { committedAt: Date.now() });
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
    updateLoad(id, { failure: { error: desc || `net error ${code}`, url } });
    pushLog(id, { kind: "load", level: "error", text: `${desc} (${code})`, url }, url);
  });
  wc.once("destroyed", () => {
    rings.delete(id);
    httpStatus.delete(id);
    loads.delete(id);
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
