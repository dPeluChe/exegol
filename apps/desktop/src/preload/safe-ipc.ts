import { ipcRenderer } from "electron";
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
export function trpcAllowed(path: string): boolean {
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

export function makeDenialError(target: string, kind: "trpc" | "ipc"): Error {
  const msg = kind === "trpc" ? `Capability denied: ${target}` : `Capability denied: ipc:${target}`;
  console.warn(`[capabilities] ${msg}`);
  return Object.assign(new Error(msg), { code: "FORBIDDEN", name: "CapabilityDeniedError" });
}

// `invoke` and `send` route synchronous-style API calls; returning a rejected
// Promise (for invoke) or throwing (for send, which is fire-and-forget) keeps
// the existing call contract intact for `.catch(...)` chains.
export const safe = {
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

/** One payload per event; returns the unsubscribe */
export function listen(channel: string, callback: (data: unknown) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, data: unknown) => callback(data);
  safe.on(channel, handler as never);
  return () => safe.off(channel, handler as never);
}
