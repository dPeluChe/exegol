import { randomUUID } from "node:crypto";
import {
  browserPartitionFor,
  PREFERRED_PORTS_KEY,
  PREVIEW_PARTITION,
  pickDevServerPort,
  projectIdFromPartition,
} from "@exegol/shared";
import { app, ipcMain, session, type WebContents, webContents } from "electron";
import type Database from "libsql";
import { queueFollowUp } from "../agents/follow-up-queue";
import { getProject } from "../db/queries/projects";
import { getJsonSetting } from "../db/queries/settings";
import {
  attachPreviewWebview,
  guardPreviewContents,
  isPreviewSession,
} from "../files-preview/preview-host";
import { broadcast } from "../lib/event-bus";
import { delay } from "../lib/timeout";
import { ExegolToolError } from "../mcp/exegol-protocol";
import { getNotificationBus } from "../notifications/bus";
import { getProjectPorts } from "../system/ports";
import { getMainWindow } from "../windows/main-window-ref";
import { handBack, listPaneStates, onBrowserControlChange, takeOver } from "./control";
import { installPageEvents, markAgentInput, takeOverPageDialogs } from "./page-events";
import { opaqueJpeg } from "./page-image";
import { installPagePermissions } from "./page-permissions";
import {
  AGENT_WORLD_ID,
  addPane,
  ISOLATED_TIMEOUT_MS,
  inProjectPartition,
  isHostedWebview,
  paneById,
  paneOfWebContents,
  panesOfProject,
  type Registered,
  setPaneRegistryDb,
  toolTimeout,
} from "./pane-registry";
import { captureFullPage } from "./screenshot";
import { type BrowserPaneHandle, setBrowserHost, setNeedsUserNotifier } from "./tool-guards";
import {
  awaitPageLoad,
  hookSession,
  lastHttpStatusOf,
  loadOf,
  pageUrlOf,
  ringOf,
  trackWebview,
} from "./webview-tracking";
import { forwardPaneZoomKeys } from "./zoom-keys";

const PANE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OPEN_TIMEOUT_MS = 15_000;
const SCREENSHOT_MAX_WIDTH = 1280;
const registrationWaiters = new Map<string, () => void>();
const pendingOpens = new Map<string, (r: { paneId?: string; error?: string }) => void>();

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
  takeOverPageDialogs(wc);
  addPane({ paneId, projectId, wcId: wc.id });
  registrationWaiters.get(paneId)?.();
  return true;
}

async function loadedFor(wc: WebContents): Promise<void> {
  if (await awaitPageLoad(wc)) {
    throw new ExegolToolError("The page is still loading: try again in a few seconds", -32021);
  }
}

function handleFor(r: Registered, wc: WebContents): BrowserPaneHandle {
  return {
    paneId: r.paneId,
    projectId: r.projectId,
    getUrl: () => wc.getURL(),
    getTitle: () => wc.getTitle(),
    runIsolated: async (code) => {
      await loadedFor(wc);
      return toolTimeout(
        wc.executeJavaScriptInIsolatedWorld(AGENT_WORLD_ID, [{ code }], true),
        ISOLATED_TIMEOUT_MS,
        "The page script",
      );
    },
    runMain: async (code, timeoutMs) => {
      await loadedFor(wc);
      return toolTimeout(wc.executeJavaScript(code, true), timeoutMs, "browser_eval");
    },
    // did-fail-load logs a failure; the promise also waits for every subresource
    loadUrl: (url) => {
      wc.loadURL(url).catch(() => {});
    },
    awaitLoad: () => awaitPageLoad(wc),
    loadState: () => loadOf(wc.id),
    capture: async (fullPage) => {
      // Right after a navigation there may be no frame to copy yet
      let img = fullPage
        ? await captureFullPage(wc)
        : await wc.capturePage().catch(() => delay(300).then(() => wc.capturePage()));
      if (img.getSize().width > SCREENSHOT_MAX_WIDTH)
        img = img.resize({ width: SCREENSHOT_MAX_WIDTH });
      return opaqueJpeg(img, 80);
    },
    moveMouse: (x, y) => {
      markAgentInput(wc.id);
      const zoom = wc.getZoomFactor();
      wc.sendInputEvent({
        type: "mouseMove",
        x: Math.round(x * zoom),
        y: Math.round(y * zoom),
      });
    },
    history: (action) => {
      const { navigationHistory: nav } = wc;
      if (action === "reload") wc.reload();
      else if (action === "back" && nav.canGoBack()) nav.goBack();
      else if (action === "forward" && nav.canGoForward()) nav.goForward();
      else return false;
      return true;
    },
    sendKey: (keyCode, modifiers) => {
      const mods = modifiers as ("shift" | "control" | "alt" | "meta")[];
      markAgentInput(wc.id);
      wc.sendInputEvent({ type: "keyDown", keyCode, modifiers: mods });
      if (keyCode.length === 1 && !mods.some((m) => m === "control" || m === "meta")) {
        wc.sendInputEvent({ type: "char", keyCode, modifiers: mods });
      }
      wc.sendInputEvent({ type: "keyUp", keyCode, modifiers: mods });
    },
    lastHttpStatus: () => lastHttpStatusOf(wc.id),
    logs: ringOf(wc.id),
  };
}

function livePanes(projectId: string): BrowserPaneHandle[] {
  const out: BrowserPaneHandle[] = [];
  for (const r of panesOfProject(projectId)) {
    const wc = webContents.fromId(r.wcId);
    if (!wc || !inProjectPartition(wc, projectId)) continue;
    out.push(handleFor(r, wc));
  }
  return out;
}

function waitForRegistration(paneId: string, projectId: string): Promise<BrowserPaneHandle> {
  const now = livePanes(projectId).find((p) => p.paneId === paneId);
  if (now) return Promise.resolve(now);
  return toolTimeout(
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
  const result = await toolTimeout(
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

/** Hand back with no agent waiting on it: tell the agent that last drove the pane */
function handBackAndTell(db: Database.Database, paneId: string): boolean {
  const r = handBack(paneId);
  if (!r) return false;
  if (!r.woke && r.agentId) {
    const reg = paneById(paneId);
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
  setPaneRegistryDb(db);
  app.on("web-contents-created", (_e, contents) => {
    if (contents.getType() === "webview") {
      // A Files preview: its own session and guard, never an agent browser pane
      if (isPreviewSession(contents.session)) guardPreviewContents(contents);
      else {
        trackWebview(contents);
        forwardPaneZoomKeys(contents, (wcId) => paneOfWebContents(wcId)?.paneId);
      }
      return;
    }
    contents.on("will-attach-webview", (event, webPreferences, params) => {
      // Pages in a pane never get Node or a preload, whatever the markup asked for
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      if (!params.partition) return;
      if (params.partition === PREVIEW_PARTITION) {
        attachPreviewWebview(event, webPreferences, params);
        return;
      }
      const projectId = projectIdFromPartition(params.partition);
      if (!projectId) {
        event.preventDefault();
        return;
      }
      // Every page of the project's partition, registered or not, gets the guard from its first load
      hookSession(session.fromPartition(params.partition), projectId);
    });
  });

  installPageEvents((wcId) => paneOfWebContents(wcId)?.paneId);
  installPagePermissions(db, paneOfWebContents);
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

  setBrowserHost({
    livePanes,
    openPane,
    devServerUrl: (projectId) => devServerUrl(db, projectId),
  });
}
