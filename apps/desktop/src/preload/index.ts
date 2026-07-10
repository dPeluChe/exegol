import { contextBridge, ipcRenderer } from "electron";
import capabilities from "./capabilities.json";

type TrpcAllow = "*" | readonly string[];
type Capabilities = {
  trpc: Readonly<Record<string, TrpcAllow>>;
  ipc: readonly string[];
};

const caps = capabilities as unknown as Capabilities;
const ipcSet = new Set(caps.ipc);

// Wildcards mean: every procedure under this router is allowed today. Tightening
// to per-procedure lists is a future migration; the gate must already be in
// place at every call site so the migration is purely a JSON edit.
function trpcAllowed(path: string): boolean {
  if (typeof path !== "string") return false;
  const dot = path.indexOf(".");
  if (dot <= 0) return false;
  const router = path.slice(0, dot);
  const procedure = path.slice(dot + 1);
  if (!procedure) return false;
  const allow = caps.trpc[router];
  if (!allow) return false;
  if (allow === "*") return true;
  return allow.includes(procedure);
}

function makeDenialError(target: string, kind: "trpc" | "ipc"): Error {
  const msg = kind === "trpc" ? `Capability denied: ${target}` : `Capability denied: ipc:${target}`;
  console.warn(`[capabilities] ${msg}`);
  return Object.assign(new Error(msg), { code: "FORBIDDEN", name: "CapabilityDeniedError" });
}

// `invoke` and `send` route synchronous-style API calls; returning a rejected
// Promise (for invoke) or throwing (for send, which is fire-and-forget) keeps
// the existing call contract intact for `.catch(...)` chains.
const safe = {
  invoke: (channel: string, ...args: unknown[]) =>
    ipcSet.has(channel)
      ? ipcRenderer.invoke(channel, ...args)
      : Promise.reject(makeDenialError(channel, "ipc")),
  send: (channel: string, ...args: unknown[]) => {
    if (!ipcSet.has(channel)) throw makeDenialError(channel, "ipc");
    ipcRenderer.send(channel, ...args);
  },
  // `on` runs inside React effects — a sync throw would crash the subtree at
  // mount time. Log the denial, return without attaching the listener, and let
  // the calling component degrade gracefully (the unsubscribe wrapper is still
  // safe to call later because removeListener with a never-attached handler
  // is a no-op in Electron).
  on: (
    channel: string,
    handler: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void,
  ) => {
    if (!ipcSet.has(channel)) {
      makeDenialError(channel, "ipc");
      return;
    }
    ipcRenderer.on(channel, handler);
  },
  off: (
    _channel: string,
    handler: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void,
  ) => {
    // Removing a listener is always safe — no allowlist gate needed.
    ipcRenderer.removeListener(_channel, handler);
  },
};

contextBridge.exposeInMainWorld("api", {
  trpc: {
    invoke: (path: string, input: unknown) => {
      if (!trpcAllowed(path)) return Promise.reject(makeDenialError(path, "trpc"));
      return ipcRenderer.invoke("trpc", { path, input });
    },
  },
  terminal: {
    onData: (id: string, callback: (data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, termId: string, data: string): void => {
        if (termId === id) callback(data);
      };
      safe.on("terminal:data", handler as never);
      return () => {
        safe.off("terminal:data", handler as never);
      };
    },
    write: (id: string, data: string) => safe.send("terminal:write", id, data),
    resize: (id: string, cols: number, rows: number) =>
      safe.send("terminal:resize", id, cols, rows),
    /** Get ring buffer snapshot for late-mounting terminals */
    getSnapshot: (id: string): Promise<string | null> => safe.invoke("terminal:get-snapshot", id),
    /** Save clipboard image as temp file, returns file path or null */
    saveClipboardImage: (): Promise<string | null> => safe.invoke("terminal:save-clipboard-image"),
  },
  app: {
    getVersion: () => safe.invoke("app:version"),
    getPlatform: () => process.platform,
  },
  // Menu-driven actions (macOS app menu routes accelerators via IPC so the
  // renderer can close panes/tabs instead of the whole window on Cmd+W).
  onMenuAction: (callback: (action: "new-tab" | "close-pane") => void) => {
    const onNewTab = () => callback("new-tab");
    const onClosePane = () => callback("close-pane");
    safe.on("menu:new-tab", onNewTab as never);
    safe.on("menu:close-pane", onClosePane as never);
    return () => {
      safe.off("menu:new-tab", onNewTab as never);
      safe.off("menu:close-pane", onClosePane as never);
    };
  },
  onAgentHandoff: (callback: (agentId: string, handoffId: string) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      agentId: string,
      handoffId: string,
    ): void => {
      callback(agentId, handoffId);
    };
    safe.on("agent:handoff-ready", handler as never);
    return () => {
      safe.off("agent:handoff-ready", handler as never);
    };
  },
  // Push event subscriptions (T17: push-first status updates)
  onAgentStatus: (callback: (event: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: unknown) => callback(data);
    safe.on("agent:status-changed", handler as never);
    return () => {
      safe.off("agent:status-changed", handler as never);
    };
  },
  onMetrics: (callback: (metrics: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: unknown) => callback(data);
    safe.on("metrics:update", handler as never);
    return () => {
      safe.off("metrics:update", handler as never);
    };
  },
  onPipelineStatus: (callback: (event: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: unknown) => callback(data);
    safe.on("pipeline:status-changed", handler as never);
    return () => {
      safe.off("pipeline:status-changed", handler as never);
    };
  },
  dialog: {
    // biome-ignore lint/suspicious/noExplicitAny: Electron dialog options are dynamic
    showOpenDialog: (options: any) => safe.invoke("dialog:showOpenDialog", options),
  },
  windowControls: {
    minimize: () => safe.send("window:minimize"),
    maximize: () => safe.send("window:maximize"),
    close: () => safe.send("window:close"),
  },
  // T47: Notification navigation
  onNotificationNavigate: (callback: (data: { agentId: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { agentId: string }) => callback(data);
    safe.on("notification:navigate", handler as never);
    return () => {
      safe.off("notification:navigate", handler as never);
    };
  },
  // T155.6: exegol:// deep link → open project by path
  onDeepLinkOpenPath: (callback: (data: { path: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { path: string }) => callback(data);
    safe.on("deeplink:open-path", handler as never);
    return () => {
      safe.off("deeplink:open-path", handler as never);
    };
  },
  // T44: Auto-updater
  updater: {
    check: () => safe.invoke("updater:check"),
    install: () => safe.invoke("updater:install"),
    onStatus: (callback: (status: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => callback(data);
      safe.on("updater:status", handler as never);
      return () => {
        safe.off("updater:status", handler as never);
      };
    },
  },
  // T102: Design Mode + QA — browser pane inspection
  browser: {
    executeJs: (code: string) => safe.invoke("browser:execute-js", { code }),
    captureScreenshot: () => safe.invoke("browser:capture-screenshot"),
    captureElement: (selector: string) => safe.invoke("browser:capture-element", { selector }),
  },
  // T120: Settings as a separate BrowserWindow
  settings: {
    /** Open the settings window (or focus it if already open) */
    open: (tab?: "general" | "clis" | "terminal" | "shortcuts" | "apikeys") =>
      safe.invoke("settings:open", tab),
    /** Close the settings window from inside it */
    selfClose: () => safe.send("settings:self-close"),
    /** Subscribe to tab deep-link events from the main window */
    onNavigate: (callback: (tab: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, tab: string) => callback(tab);
      safe.on("settings:navigate", handler as never);
      return () => {
        safe.off("settings:navigate", handler as never);
      };
    },
    /** Fan out a "settings changed" signal to peer windows after mutation. */
    broadcastChanged: () => safe.send("settings:broadcast-changed"),
    /** Subscribe to peer-window settings changes (refetch the local query cache). */
    onChanged: (callback: () => void) => {
      const handler = () => callback();
      safe.on("settings:changed", handler as never);
      return () => {
        safe.off("settings:changed", handler as never);
      };
    },
  },
  // T84: Picture-in-Picture pane floating windows
  floating: {
    /** Open a floating pane window from the main window */
    open: (config: {
      paneId: string;
      type: "terminal" | "browser";
      title: string;
      agentId?: string;
      url?: string;
      projectId?: string;
    }) => safe.invoke("floating:open", config),
    /** Close a specific floating pane window by paneId (from main window) */
    close: (paneId: string) => safe.invoke("floating:close", paneId),
    /** Close the current floating window (called from inside it) */
    selfClose: () => safe.send("floating:self-close"),
    /** Toggle devtools in the current floating window */
    selfToggleDevTools: () => safe.send("floating:self-devtools"),
    /** Main window: subscribe to "floating window closed" events */
    onClosed: (callback: (paneId: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, paneId: string) => callback(paneId);
      safe.on("floating:closed", handler as never);
      return () => {
        safe.off("floating:closed", handler as never);
      };
    },
  },
});
