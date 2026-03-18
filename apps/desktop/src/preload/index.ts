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
  dialog: {
    // biome-ignore lint/suspicious/noExplicitAny: Electron dialog options are dynamic
    showOpenDialog: (options: any) => ipcRenderer.invoke("dialog:showOpenDialog", options),
  },
  windowControls: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
  },
});
