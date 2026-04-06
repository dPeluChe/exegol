import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  trpc: {
    invoke: (path: string, input: unknown) => ipcRenderer.invoke("trpc", { path, input }),
  },
  terminal: {
    onData: (id: string, callback: (data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, termId: string, data: string): void => {
        if (termId === id) callback(data);
      };
      ipcRenderer.on("terminal:data", handler);
      return () => {
        ipcRenderer.removeListener("terminal:data", handler);
      };
    },
    write: (id: string, data: string) => ipcRenderer.send("terminal:write", id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send("terminal:resize", id, cols, rows),
    /** Save clipboard image as temp file, returns file path or null */
    saveClipboardImage: (): Promise<string | null> =>
      ipcRenderer.invoke("terminal:save-clipboard-image"),
  },
  app: {
    getVersion: () => ipcRenderer.invoke("app:version"),
    getPlatform: () => process.platform,
  },
  onAgentHandoff: (callback: (agentId: string, handoffId: string) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      agentId: string,
      handoffId: string,
    ): void => {
      callback(agentId, handoffId);
    };
    ipcRenderer.on("agent:handoff-ready", handler);
    return () => {
      ipcRenderer.removeListener("agent:handoff-ready", handler);
    };
  },
  // Push event subscriptions (T17: push-first status updates)
  onAgentStatus: (callback: (event: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("agent:status-changed", handler);
    return () => {
      ipcRenderer.removeListener("agent:status-changed", handler);
    };
  },
  onMetrics: (callback: (metrics: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("metrics:update", handler);
    return () => {
      ipcRenderer.removeListener("metrics:update", handler);
    };
  },
  onPipelineStatus: (callback: (event: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("pipeline:status-changed", handler);
    return () => {
      ipcRenderer.removeListener("pipeline:status-changed", handler);
    };
  },
  dialog: {
    // biome-ignore lint/suspicious/noExplicitAny: Electron dialog options are dynamic
    showOpenDialog: (options: any) => ipcRenderer.invoke("dialog:showOpenDialog", options),
  },
  windowControls: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
  },
  // T47: Notification navigation
  onNotificationNavigate: (callback: (data: { agentId: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { agentId: string }) => callback(data);
    ipcRenderer.on("notification:navigate", handler);
    return () => {
      ipcRenderer.removeListener("notification:navigate", handler);
    };
  },
  // T44: Auto-updater
  updater: {
    check: () => ipcRenderer.invoke("updater:check"),
    install: () => ipcRenderer.invoke("updater:install"),
    onStatus: (callback: (status: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("updater:status", handler);
      return () => {
        ipcRenderer.removeListener("updater:status", handler);
      };
    },
  },
});
