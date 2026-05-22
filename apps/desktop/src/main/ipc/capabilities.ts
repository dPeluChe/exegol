import capabilities from "../../preload/capabilities.json";

type TrpcAllow = "*" | readonly string[];
type Capabilities = {
  trpc: Readonly<Record<string, TrpcAllow>>;
  ipc: readonly string[];
};

const caps = capabilities as unknown as Capabilities;
const ipcSet = new Set(caps.ipc);

export function isTrpcPathAllowed(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
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

export function isIpcChannelAllowed(channel: string): boolean {
  return ipcSet.has(channel);
}

export class CapabilityDeniedError extends Error {
  readonly kind: "trpc" | "ipc";
  readonly target: string;
  constructor(kind: "trpc" | "ipc", target: string) {
    super(`Capability denied: ${kind === "trpc" ? target : `ipc:${target}`}`);
    this.name = "CapabilityDeniedError";
    this.kind = kind;
    this.target = target;
  }
}
