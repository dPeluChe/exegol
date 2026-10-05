import { randomUUID } from "node:crypto";
import { browserPartitionFor, projectIdFromPartition } from "@exegol/shared";
import { app, ipcMain, type Session, session, type WebContents, webContents } from "electron";
import type Database from "libsql";
import { getProject, listProjects } from "../db/queries/projects";
import { getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { getNotificationBus } from "../notifications/bus";
import { listDevServers } from "../system/dev-servers";
import { getMainWindow } from "../windows/main-window-ref";
import {
  type BrowserHost,
  type BrowserPaneHandle,
  BrowserToolError,
  setBrowserHost,
  setNeedsUserNotifier,
} from "./agent-browser-tools";
import { handBack, listPaneStates, onBrowserControlChange, takeOver } from "./control";
import { selectCookiesToCopy, toSetDetails } from "./cookie-migration";
import { type BrowserLogEntry, LogRing, toLogLevel } from "./log-ring";

const PANE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Our own isolated world in the page: refs live there, out of the page's reach */
const AGENT_WORLD_ID = 1337;
const ISOLATED_TIMEOUT_MS = 10_000;
const OPEN_TIMEOUT_MS = 15_000;
const PREFERRED_PORTS_KEY = "project_preferred_ports";
const COOKIES_MIGRATED_KEY = "browser_partition_cookies_migrated";

interface Registered {
  paneId: string;
  projectId: string;
  wcId: number;
}

const registered = new Map<string, Registered>();
const rings = new Map<number, LogRing>();
const httpStatus = new Map<number, number>();
const hookedSessions = new WeakSet<Session>();
const registrationWaiters = new Map<string, () => void>();
const pendingOpens = new Map<string, (r: { paneId?: string; error?: string }) => void>();

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new BrowserToolError(`${what} timed out`, -32027)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const projectSession = (projectId: string) => session.fromPartition(browserPartitionFor(projectId));

/** The webview runs in this project's own partition: the check every agent call goes through */
function inProjectPartition(wc: WebContents, projectId: string): boolean {
  return (
    !wc.isDestroyed() && wc.getType() === "webview" && wc.session === projectSession(projectId)
  );
}

function ringOf(wcId: number): LogRing {
  let ring = rings.get(wcId);
  if (!ring) {
    ring = new LogRing();
    rings.set(wcId, ring);
  }
  return ring;
}

function hostOfUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** Each entry remembers the host of the page it came from: the tool hides the ones logged while
 *  the pane was on a site outside the project's hosts */
function pushLog(wcId: number, entry: Omit<BrowserLogEntry, "seq" | "at">, pageUrl?: string) {
  const ring = rings.get(wcId);
  if (!ring) return;
  const wc = pageUrl === undefined ? webContents.fromId(wcId) : undefined;
  const url = pageUrl ?? (wc && !wc.isDestroyed() ? wc.getURL() : "");
  ring.push({ ...entry, page: hostOfUrl(url) });
}

/** Console, uncaught errors and failed loads of every webview, from the moment it exists */
function trackWebview(wc: WebContents): void {
  const id = wc.id;
  ringOf(id);
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
    for (const [paneId, r] of registered) if (r.wcId === id) registered.delete(paneId);
  });
}

/** Failed and 4xx/5xx requests of a project's pages (one listener per session is all Electron has) */
function hookSession(ses: Session): void {
  if (hookedSessions.has(ses)) return;
  hookedSessions.add(ses);
  ses.webRequest.onCompleted((d) => {
    if (d.statusCode < 400 || d.webContentsId === undefined) return;
    pushLog(d.webContentsId, {
      kind: "network",
      level: d.statusCode >= 500 ? "error" : "warning",
      text: `${d.method} ${d.url} ${d.statusCode}`,
      status: d.statusCode,
      method: d.method,
      url: d.url,
    });
  });
  ses.webRequest.onErrorOccurred((d) => {
    if (d.error === "net::ERR_ABORTED" || d.webContentsId === undefined) return;
    pushLog(d.webContentsId, {
      kind: "network",
      level: "error",
      text: `${d.method} ${d.url} ${d.error}`,
      method: d.method,
      url: d.url,
    });
  });
}

function registerPane(
  db: Database.Database,
  sender: WebContents,
  input: { paneId?: unknown; projectId?: unknown; webContentsId?: unknown },
): boolean {
  const { paneId, projectId, webContentsId } = input;
  if (typeof paneId !== "string" || !PANE_ID_RE.test(paneId)) return false;
  if (typeof projectId !== "string" || !projectIdFromPartition(browserPartitionFor(projectId))) {
    return false;
  }
  if (typeof webContentsId !== "number" || !getProject(db, projectId)) return false;
  const wc = webContents.fromId(webContentsId);
  // Only a webview this window hosts, in that project's partition: a renderer cannot hand an
  // agent another project's page by claiming its id
  if (!wc || wc.hostWebContents !== sender || !inProjectPartition(wc, projectId)) return false;
  hookSession(wc.session);
  registered.set(paneId, { paneId, projectId, wcId: wc.id });
  registrationWaiters.get(paneId)?.();
  return true;
}

function handleFor(r: Registered, wc: WebContents): BrowserPaneHandle {
  return {
    paneId: r.paneId,
    projectId: r.projectId,
    getUrl: () => wc.getURL(),
    getTitle: () => wc.getTitle(),
    runIsolated: (code) =>
      withTimeout(
        wc.executeJavaScriptInIsolatedWorld(AGENT_WORLD_ID, [{ code }], true),
        ISOLATED_TIMEOUT_MS,
        "The page script",
      ),
    runMain: (code, timeoutMs) =>
      withTimeout(wc.executeJavaScript(code, true), timeoutMs, "browser_eval"),
    loadUrl: async (url) => {
      try {
        await wc.loadURL(url);
      } catch (err) {
        // A redirect aborts the first load; the page that follows is what the tool reports
        if (!String(err).includes("ERR_ABORTED")) {
          pushLog(
            wc.id,
            { kind: "load", level: "error", text: String(err).slice(0, 300), url },
            url,
          );
        }
      }
    },
    capture: async () => (await wc.capturePage()).toPNG(),
    sendKey: (keyCode, modifiers) => {
      const mods = modifiers as ("shift" | "control" | "alt" | "meta")[];
      wc.sendInputEvent({ type: "keyDown", keyCode, modifiers: mods });
      if (keyCode.length === 1 && !mods.some((m) => m === "control" || m === "meta")) {
        wc.sendInputEvent({ type: "char", keyCode, modifiers: mods });
      }
      wc.sendInputEvent({ type: "keyUp", keyCode, modifiers: mods });
    },
    lastHttpStatus: () => httpStatus.get(wc.id) ?? null,
    logs: ringOf(wc.id),
  };
}

function livePanes(projectId: string): BrowserPaneHandle[] {
  const out: BrowserPaneHandle[] = [];
  for (const r of registered.values()) {
    if (r.projectId !== projectId) continue;
    const wc = webContents.fromId(r.wcId);
    if (!wc || !inProjectPartition(wc, projectId)) continue;
    out.push(handleFor(r, wc));
  }
  return out;
}

function waitForRegistration(paneId: string, projectId: string): Promise<BrowserPaneHandle> {
  const now = livePanes(projectId).find((p) => p.paneId === paneId);
  if (now) return Promise.resolve(now);
  return withTimeout(
    new Promise<BrowserPaneHandle>((resolve) => {
      registrationWaiters.set(paneId, () => {
        const p = livePanes(projectId).find((x) => x.paneId === paneId);
        if (!p) return;
        registrationWaiters.delete(paneId);
        resolve(p);
      });
    }),
    OPEN_TIMEOUT_MS,
    "Opening the browser pane",
  ).finally(() => registrationWaiters.delete(paneId));
}

async function openPane(req: { projectId: string; agentId: string; url: string }) {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) {
    throw new BrowserToolError("Exegol's window is closed: no browser pane can open", -32603);
  }
  const requestId = randomUUID();
  const result = await withTimeout(
    new Promise<{ paneId?: string; error?: string }>((resolve) => {
      pendingOpens.set(requestId, resolve);
      win.webContents.send("browser:open-request", { requestId, ...req });
    }),
    OPEN_TIMEOUT_MS,
    "Opening the browser pane",
  ).finally(() => pendingOpens.delete(requestId));
  if (!result.paneId) {
    throw new BrowserToolError(result.error ?? "Exegol could not open a browser pane", -32028);
  }
  return waitForRegistration(result.paneId, req.projectId);
}

async function devServerUrl(db: Database.Database, projectId: string): Promise<string | null> {
  const servers = (await listDevServers(db)).filter((s) => s.project?.id === projectId);
  const ports = servers.flatMap((s) => s.ports);
  if (ports.length === 0) return null;
  const preferred = getJsonSetting<Record<string, number>>(db, PREFERRED_PORTS_KEY, {})[projectId];
  const port = preferred && ports.includes(preferred) ? preferred : ports[0];
  return `http://localhost:${port}`;
}

/** Once per project: the cookies its panes had in the shared session move into its own partition,
 *  for the hosts its agents may open (no re-login after the switch) */
export async function migrateBrowserCookies(db: Database.Database): Promise<void> {
  const done = new Set(getJsonSetting<string[]>(db, COOKIES_MIGRATED_KEY, []));
  const pending = listProjects(db).filter((p) => !done.has(p.id));
  if (pending.length === 0) return;
  const nowSec = Date.now() / 1000;
  const all = await session.defaultSession.cookies.get({});
  for (const project of pending) {
    const target = projectSession(project.id);
    const picked = selectCookiesToCopy(all, project.browserHosts ?? [], nowSec);
    // allSettled: one bad cookie must not stop the rest
    const results = await Promise.allSettled(
      picked.map((cookie) => target.cookies.set(toSetDetails(cookie))),
    );
    const copied = results.filter((r) => r.status === "fulfilled").length;
    done.add(project.id);
    if (copied > 0) logger.info(`[AgentBrowser] Copied ${copied} cookies into a project partition`);
  }
  setJsonSetting(db, COOKIES_MIGRATED_KEY, [...done]);
}

export function installAgentBrowser(db: Database.Database): void {
  app.on("web-contents-created", (_e, contents) => {
    if (contents.getType() === "webview") {
      trackWebview(contents);
      return;
    }
    contents.on("will-attach-webview", (event, webPreferences, params) => {
      // Pages in a pane never get Node or a preload, whatever the markup asked for
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      if (params.partition && !projectIdFromPartition(params.partition)) event.preventDefault();
    });
  });

  ipcMain.handle("browser:register-pane", (event, input) =>
    registerPane(db, event.sender, input ?? {}),
  );
  ipcMain.handle("browser:control", (_event, input: { paneId?: unknown; action?: unknown }) => {
    if (typeof input?.paneId !== "string") return false;
    if (input.action === "take-over") return takeOver(input.paneId);
    if (input.action === "hand-back") return handBack(input.paneId);
    return false;
  });
  ipcMain.handle("browser:agent-states", () => listPaneStates());
  ipcMain.handle(
    "browser:open-result",
    (_event, input: { requestId?: unknown; paneId?: unknown; error?: unknown }) => {
      if (typeof input?.requestId !== "string") return;
      pendingOpens.get(input.requestId)?.({
        paneId:
          typeof input.paneId === "string" && PANE_ID_RE.test(input.paneId)
            ? input.paneId
            : undefined,
        error: typeof input.error === "string" ? input.error.slice(0, 300) : undefined,
      });
    },
  );

  onBrowserControlChange((state) => broadcast("browser:agent-state", state));
  setNeedsUserNotifier((ctx, alias, _paneId, what) => {
    try {
      getNotificationBus().emit({
        type: "agent:attention",
        title: `${alias ?? "An agent"} needs you in the browser`,
        body: what,
        agentId: ctx.agentId,
        projectId: ctx.projectId,
        at: Date.now(),
      });
    } catch {
      /* notifications are best-effort */
    }
  });

  const host: BrowserHost = {
    livePanes,
    openPane,
    devServerUrl: (projectId) => devServerUrl(db, projectId),
  };
  setBrowserHost(host);
}
