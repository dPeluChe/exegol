/** A process listening on a TCP port, as the Monitor's dev-server list shows it */
export interface DevServer {
  pid: number;
  ports: number[];
  /** Short process name from lsof (node, bun, python3...) */
  process: string;
  /** Full command line, for the tooltip */
  command: string;
  /** Seconds since the process started */
  uptimeSeconds: number | null;
  cwd: string | null;
  /** Exegol project whose folder holds the process's cwd */
  project: { id: string; name: string } | null;
  /** Exegol agent or shell whose terminal started it (found up the parent chain) */
  agent: { id: string; projectId: string; cliType: string; alias: string | null } | null;
  /** Another process listens on one of these ports too */
  conflict: boolean;
}

/** Settings key: the port each project's browser pane opens by default */
export const PREFERRED_PORTS_KEY = "project_preferred_ports";

export interface DevPort {
  port: number;
  source?: string;
  pid?: number;
  process?: string;
}

const INSPECTOR_PORTS = new Set([9229, 9230]);
// Ports the OS hands out (Linux from 32768, macOS from 49152): a dev tool's own channels, not a page
const ASSIGNED_FROM = 32768;

/** One entry per port, a running server over a configured one */
export function dedupeDevPorts<T extends DevPort>(ports: readonly T[] | undefined): T[] {
  const map = new Map<number, T>();
  for (const p of ports ?? []) {
    const existing = map.get(p.port);
    if (!existing || (p.source === "runtime" && existing.source !== "runtime")) map.set(p.port, p);
  }
  return [...map.values()];
}

function isPage(p: DevPort): boolean {
  return (
    !INSPECTOR_PORTS.has(p.port) &&
    p.process !== "workerd" &&
    (p.source !== "runtime" || p.port < ASSIGNED_FROM)
  );
}

function helperNote(p: DevPort, pages: readonly DevPort[]): string {
  if (INSPECTOR_PORTS.has(p.port)) return "Node.js debugger (inspector)";
  if (p.process === "workerd") return "Cloudflare Workers local runtime (workerd)";
  const name = p.process ?? "the server";
  const sibling = pages.find((m) => m.pid !== undefined && m.pid === p.pid);
  return sibling
    ? `Internal port of ${name}, same process as :${sibling.port}`
    : `Internal port of ${name}`;
}

/**
 * Pages a browser should open vs the helper ports a dev server opens beside them (debugger,
 * Cloudflare's workerd, OS-assigned channels), each with what it is. No page: all are pages.
 */
export function splitDevPorts<T extends DevPort>(
  ports: readonly T[],
): { pages: T[]; helpers: { port: T; note: string }[] } {
  const pages = ports.filter(isPage);
  if (pages.length === 0) return { pages: [...ports], helpers: [] };
  const helpers = ports
    .filter((p) => !isPage(p))
    .map((p) => ({ port: p, note: helperNote(p, pages) }));
  return { pages, helpers };
}

/** The port a project's browser opens: the preferred one, else a running page, else the first page */
export function pickDevServerPort(
  ports: readonly DevPort[],
  preferred?: number | null,
): number | undefined {
  const { pages } = splitDevPorts(ports);
  return preferred ?? pages.find((p) => p.source === "runtime")?.port ?? pages[0]?.port;
}
