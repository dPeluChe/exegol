import { randomUUID } from "node:crypto";
import {
  browserPartitionFor,
  hostOf,
  isOutsideAllowlist,
  PREFERRED_PORTS_KEY,
  pickDevServerPort,
  projectIdFromPartition,
} from "@exegol/shared";
import { app, ipcMain, type Session, session, type WebContents, webContents } from "electron";
import type Database from "libsql";
import { queueFollowUp } from "../agents/follow-up-queue";
import { getProject, listProjects } from "../db/queries/projects";
import { getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { ExegolToolError } from "../mcp/exegol-protocol";
import { getNotificationBus } from "../notifications/bus";
import { getProjectPorts } from "../system/ports";
import { getMainWindow } from "../windows/main-window-ref";
import {
  forgetPane,
  handBack,
  isAgentActing,
  listPaneStates,
  onBrowserControlChange,
  takeOver,
} from "./control";
import { projectsToMigrate, selectCookiesToCopy, toSetDetails } from "./cookie-migration";
import { type BrowserLogEntry, LogRing, toLogLevel } from "./log-ring";
import { blocksAgentRequest, logUrl } from "./request-guard";
import {
  type BrowserHost,
  type BrowserPaneHandle,
  setBrowserHost,
  setNeedsUserNotifier,
} from "./tool-guards";

const PANE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Our own isolated world in the page: refs live there, out of the page's reach */
const AGENT_WORLD_ID = 1337;
const ISOLATED_TIMEOUT_MS = 10_000;
const OPEN_TIMEOUT_MS = 15_000;
const SCREENSHOT_MAX_WIDTH = 1280;
/** Projects whose partition got the one-time copy (or were created after it) */
const COOKIES_MIGRATED_KEY = "browser_partition_cookies_migrated";
/** Set once the one-time upgrade copy ran: it never runs again */
const COOKIES_UPGRADE_DONE_KEY = "browser_partition_cookies_upgrade_done";

interface Registered {
  paneId: string;
  projectId: string;
  wcId: number;
}

const registered = new Map<string, Registered>();
const rings = new Map<number, LogRing>();
const httpStatus = new Map<number, number>();
const projectBySession = new WeakMap<Session, string>();
const registrationWaiters = new Map<string, () => void>();
const pendingOpens = new Map<string, (r: { paneId?: string; error?: string }) => void>();
let dbRef: Database.Database | null = null;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ExegolToolError(`${what} timed out`, -32027)), ms);
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

/** A webview the given window hosts (the check every renderer-supplied webContents id goes
 *  through) */
export function isHostedWebview(
  wc: WebContents | undefined | null,
  host: WebContents,
): wc is WebContents {
  return !!wc && !wc.isDestroyed() && wc.getType() === "webview" && wc.hostWebContents === host;
}

/** The webview runs in this project's own partition: the check every agent call goes through */
function inProjectPartition(wc: WebContents, projectId: string): boolean {
  return (
    !wc.isDestroyed() && wc.getType() === "webview" && wc.session === projectSession(projectId)
  );
}

const allowedHostsOf = (projectId: string) =>
  (dbRef && getProject(dbRef, projectId)?.browserHosts) || [];

function paneOfWebContents(wcId: number): Registered | undefined {
  for (const r of registered.values()) if (r.wcId === wcId) return r;
  return undefined;
}

/** An agent is driving this webview (or, for a request with no webview, any pane of the project) */
function agentActingOn(projectId: string, wcId: number | undefined): boolean {
  if (wcId !== undefined) {
    const r = paneOfWebContents(wcId);
    return !!r && isAgentActing(r.paneId);
  }
  for (const r of registered.values()) {
    if (r.projectId === projectId && isAgentActing(r.paneId)) return true;
  }
  return false;
}

function ringOf(wcId: number): LogRing {
  let ring = rings.get(wcId);
  if (!ring) {
    ring = new LogRing();
    rings.set(wcId, ring);
  }
  return ring;
}

function pageUrlOf(wcId: number): string {
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
    if (projectId && /^https?:/i.test(url) && !isOutsideAllowlist(url, allowedHostsOf(projectId))) {
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
    if (isOutsideAllowlist(event.url, allowedHostsOf(projectId))) {
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
function trackWebview(wc: WebContents): void {
  const id = wc.id;
  ringOf(id);
  guardWebview(wc);
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
    for (const [paneId, r] of registered) {
      if (r.wcId !== id) continue;
      registered.delete(paneId);
      forgetPane(paneId);
    }
  });
}

/** Network log and the agent request guard of a project's session (Electron allows one listener
 *  per event and session) */
function hookSession(ses: Session, projectId: string): void {
  if (projectBySession.has(ses)) return;
  projectBySession.set(ses, projectId);
  ses.webRequest.onBeforeRequest((d, callback) => {
    const acting = agentActingOn(projectId, d.webContentsId);
    const cancel = acting && blocksAgentRequest(d.url, acting, allowedHostsOf(projectId));
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
  if (!isHostedWebview(wc, sender) || !inProjectPartition(wc, projectId)) return false;
  hookSession(wc.session, projectId);
  registered.set(paneId, { paneId, projectId, wcId: wc.id });
  registrationWaiters.get(paneId)?.();
  return true;
}

/** Dictation: types into the focused element of a pane's page. Only a pane registered for that
 *  project and hosted by the asking window, so a renderer cannot reach another project's page */
export function insertTextInBrowserPane(
  sender: WebContents,
  input: { paneId?: unknown; projectId?: unknown; text?: unknown },
): boolean {
  const { paneId, projectId, text } = input;
  if (typeof paneId !== "string" || typeof text !== "string" || !text) return false;
  const r = registered.get(paneId);
  if (!r || r.projectId !== projectId || isAgentActing(r.paneId)) return false;
  const wc = webContents.fromId(r.wcId);
  if (!isHostedWebview(wc, sender) || !inProjectPartition(wc, r.projectId)) return false;
  wc.focus();
  void wc.insertText(text);
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
    capture: async () => {
      let img = await wc.capturePage();
      if (img.getSize().width > SCREENSHOT_MAX_WIDTH)
        img = img.resize({ width: SCREENSHOT_MAX_WIDTH });
      return img.toJPEG(80);
    },
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
    throw new ExegolToolError("Exegol's window is closed: no browser pane can open", -32603);
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
    throw new ExegolToolError(result.error ?? "Exegol could not open a browser pane", -32028);
  }
  return waitForRegistration(result.paneId, req.projectId);
}

/** The project's running dev server, picked like a new browser pane picks it */
async function devServerUrl(db: Database.Database, projectId: string): Promise<string | null> {
  const project = getProject(db, projectId);
  if (!project) return null;
  const running = (await getProjectPorts(project.path)).filter((p) => p.source === "runtime");
  const preferred = getJsonSetting<Record<string, number>>(db, PREFERRED_PORTS_KEY, {})[projectId];
  const port = pickDevServerPort(
    running,
    running.some((p) => p.port === preferred) ? preferred : null,
  );
  return port ? `http://localhost:${port}` : null;
}

async function copyCookies(
  projectId: string,
  scope: { local: boolean; hosts: readonly string[] },
): Promise<number> {
  const all = await session.defaultSession.cookies.get({});
  const picked = selectCookiesToCopy(all, scope, Date.now() / 1000);
  const target = projectSession(projectId);
  // allSettled: one bad cookie must not stop the rest
  const results = await Promise.allSettled(
    picked.map((cookie) => target.cookies.set(toSetDetails(cookie))),
  );
  return results.filter((r) => r.status === "fulfilled").length;
}

/** Hosts just added to a project's allowlist bring their logins from the old shared session */
export async function copyCookiesForHosts(projectId: string, hosts: string[]): Promise<void> {
  if (hosts.length === 0) return;
  const copied = await copyCookies(projectId, { local: false, hosts });
  if (copied > 0) logger.info(`[AgentBrowser] Copied ${copied} cookies for newly allowed hosts`);
}

/** A project created after the upgrade starts with an empty partition: never part of the copy */
export function markCookiesMigrated(db: Database.Database, projectId: string): void {
  const done = getJsonSetting<string[]>(db, COOKIES_MIGRATED_KEY, []);
  if (!done.includes(projectId)) setJsonSetting(db, COOKIES_MIGRATED_KEY, [...done, projectId]);
}

/** Once, on the upgrade: the projects that shared the default session get its local-host
 *  cookies (and their allowlist's) in their own partition, so nobody logs in again */
export async function migrateBrowserCookies(db: Database.Database): Promise<void> {
  const state = {
    done: getJsonSetting<boolean>(db, COOKIES_UPGRADE_DONE_KEY, false),
    migrated: getJsonSetting<string[]>(db, COOKIES_MIGRATED_KEY, []),
  };
  const projects = listProjects(db);
  const pending = projectsToMigrate(
    projects.map((p) => p.id),
    state,
  );
  const migrated = new Set(state.migrated);
  for (const project of projects) {
    if (!pending.includes(project.id)) continue;
    const copied = await copyCookies(project.id, {
      local: true,
      hosts: project.browserHosts ?? [],
    });
    migrated.add(project.id);
    if (copied > 0) logger.info(`[AgentBrowser] Copied ${copied} cookies into a project partition`);
  }
  setJsonSetting(db, COOKIES_MIGRATED_KEY, [...migrated]);
  setJsonSetting(db, COOKIES_UPGRADE_DONE_KEY, true);
}

/** Hand back with no agent waiting on it: tell the agent that last drove the pane */
function handBackAndTell(db: Database.Database, paneId: string): boolean {
  const r = handBack(paneId);
  if (!r) return false;
  if (!r.woke && r.agentId) {
    const reg = registered.get(paneId);
    const url = reg ? pageUrlOf(reg.wcId) : "";
    try {
      queueFollowUp(db, r.agentId, `The user handed the browser back: ${url || "(no page)"}`);
    } catch {
      /* the agent is gone */
    }
  }
  return true;
}

export function installAgentBrowser(db: Database.Database): void {
  dbRef = db;
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
      if (!params.partition) return;
      const projectId = projectIdFromPartition(params.partition);
      if (!projectId) {
        event.preventDefault();
        return;
      }
      // Every page of the project's partition, registered or not, gets the guard from its first load
      hookSession(session.fromPartition(params.partition), projectId);
    });
  });

  ipcMain.handle("browser:register-pane", (event, input) =>
    registerPane(db, event.sender, input ?? {}),
  );
  ipcMain.handle("browser:control", (_event, input: { paneId?: unknown; action?: unknown }) => {
    if (typeof input?.paneId !== "string") return false;
    if (input.action === "take-over") return takeOver(input.paneId);
    if (input.action === "hand-back") return handBackAndTell(db, input.paneId);
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
  setNeedsUserNotifier((ctx, alias, what) => {
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
