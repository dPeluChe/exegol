import { execFile } from "node:child_process";
import { readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { AsyncLruCache } from "../lib/lru-cache";

const execFileAsync = promisify(execFile);

interface DetectedPort {
  port: number;
  pid: number;
  process: string;
  source: "runtime";
}

interface ConfiguredPort {
  port: number;
  source: "config";
  file: string;
}

type PortInfo = DetectedPort | ConfiguredPort;

// Every sidebar project row and the dev-server list poll ports on their own: without a
// short cache N rows ran the same lsof scans N times per tick
const SCAN_TTL_MS = 3_000;
const cwdScans = new AsyncLruCache<string, Map<number, string>>(4, SCAN_TTL_MS);
const listenerScans = new AsyncLruCache<string, TcpListener[]>(4, SCAN_TTL_MS);

interface TcpListener {
  port: number;
  pid: number;
  process: string;
}

/** The cwd of each pid: /proc on Linux, else (or for what /proc did not give) one lsof call */
export function getProcessCwds(pids: number[]): Promise<Map<number, string>> {
  return cwdScans.getOrCompute([...pids].sort().join(","), () => scanProcessCwds(pids));
}

/** lsof's output from a failed run: it exits 1 when a pid is gone or nothing matches, and
 *  still printed the rest. Not run at all (missing, timed out) throws: no answer is not "none" */
export function lsofStdout(err: unknown): string {
  const e = err as { code?: unknown; killed?: boolean; stdout?: string };
  if (typeof e.code !== "number" || e.killed) throw new Error("lsof unavailable");
  return e.stdout ?? "";
}

/** Linux: each pid's cwd from /proc, no lsof needed; pids it cannot read are left out */
export async function readProcCwds(
  pids: number[],
  read: (path: string) => Promise<string> = (path) => readlink(path),
): Promise<Map<number, string>> {
  const found = await Promise.all(
    pids.map((pid) =>
      read(`/proc/${pid}/cwd`).then(
        (cwd) => [pid, cwd] as const,
        () => null,
      ),
    ),
  );
  return new Map(found.filter((f) => f !== null));
}

async function scanProcessCwds(pids: number[]): Promise<Map<number, string>> {
  const cwds = process.platform === "linux" ? await readProcCwds(pids) : new Map<number, string>();
  const rest = pids.filter((pid) => !cwds.has(pid));
  if (rest.length === 0) return cwds;
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("lsof", ["-a", "-d", "cwd", "-p", rest.join(","), "-Fpn"], {
      timeout: 5000,
    }));
  } catch (err) {
    try {
      stdout = lsofStdout(err);
    } catch {
      return cwds;
    }
  }
  let pid = 0;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid && !cwds.has(pid)) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

/** `cwd` is `root` or inside it (a path boundary: /repo-2 is not in /repo) */
export function isInside(cwd: string | null | undefined, root: string): boolean {
  return !!cwd && (cwd === root || cwd.startsWith(`${root}/`));
}

/**
 * One `lsof -iTCP -sTCP:LISTEN -P -n` row. The last column is "(LISTEN)", not
 * the address: reading the port from it matched nothing, so no dev server was
 * ever detected and the browser pane fell back to :3000.
 */
export function parseLsofListenLine(line: string): TcpListener | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 9) return null;
  const portMatch = line.match(/:(\d+)\s+\(LISTEN\)\s*$/) ?? line.match(/:(\d+)\s*$/);
  if (!portMatch?.[1]) return null;
  return {
    port: Number.parseInt(portMatch[1], 10),
    pid: Number.parseInt(parts[1] ?? "0", 10),
    process: parts[0] ?? "",
  };
}

/**
 * TCP listeners, one entry per pid:port; `uid` limits them to that user's processes.
 * `fresh` skips the 3s cache (a kill check must see the process listening now). Rejects when
 * lsof could not run, so a caller can tell "no listeners" from "no answer".
 */
export function listTcpListeners(uid?: string, fresh = false): Promise<TcpListener[]> {
  return fresh
    ? scanTcpListeners(uid)
    : listenerScans.getOrCompute(uid ?? "", () => scanTcpListeners(uid));
}

async function scanTcpListeners(uid?: string): Promise<TcpListener[]> {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync(
      "lsof",
      [...(uid ? ["-a", "-u", uid] : []), "-iTCP", "-sTCP:LISTEN", "-P", "-n"],
      { timeout: 5000 },
    ));
  } catch (err) {
    stdout = lsofStdout(err);
  }
  const seen = new Set<string>();
  const entries: TcpListener[] = [];
  for (const line of stdout.split("\n").slice(1)) {
    const entry = parseLsofListenLine(line);
    if (!entry || seen.has(`${entry.pid}:${entry.port}`)) continue;
    seen.add(`${entry.pid}:${entry.port}`);
    entries.push(entry);
  }
  return entries;
}

/** Listening TCP ports whose process runs inside projectPath */
async function detectListeningPorts(projectPath: string): Promise<DetectedPort[]> {
  const listeners = await listTcpListeners().catch(() => []);
  const cwds = await getProcessCwds([...new Set(listeners.map((l) => l.pid))]);
  return listeners
    .filter((l) => isInside(cwds.get(l.pid), projectPath))
    .map(({ port, pid, process: proc }) => ({
      port,
      pid,
      process: proc,
      source: "runtime" as const,
    }));
}

function parsePortFromMatch(match: RegExpMatchArray | null, index: number): number | null {
  const val = match?.[index];
  if (!val) return null;
  const n = Number.parseInt(val, 10);
  return n > 0 && n <= 65535 ? n : null;
}

/** Parse common config files for expected port numbers */
async function parseConfigPorts(projectPath: string): Promise<ConfiguredPort[]> {
  const ports: ConfiguredPort[] = [];
  const seen = new Set<number>();

  const addPort = (port: number | null, file: string) => {
    if (port && !seen.has(port)) {
      seen.add(port);
      ports.push({ port, source: "config", file });
    }
  };

  // package.json scripts: --port NNNN or -p NNNN
  try {
    const raw = await readFile(join(projectPath, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    if (pkg.scripts) {
      for (const script of Object.values(pkg.scripts)) {
        const matches = (script as string).match(/(?:--port|-p)\s+(\d+)/g);
        if (matches) {
          for (const m of matches) {
            addPort(parsePortFromMatch(m.match(/(\d+)/), 1), "package.json");
          }
        }
      }
    }
  } catch {
    /* no package.json */
  }

  // .env and .env.local: PORT=NNNN
  for (const envFile of [".env", ".env.local"]) {
    try {
      const raw = await readFile(join(projectPath, envFile), "utf-8");
      addPort(parsePortFromMatch(raw.match(/^PORT\s*=\s*(\d+)/m), 1), envFile);
    } catch {
      /* file doesn't exist */
    }
  }

  // vite.config.ts/js: server: { port: NNNN }
  for (const viteFile of ["vite.config.ts", "vite.config.js"]) {
    try {
      const raw = await readFile(join(projectPath, viteFile), "utf-8");
      addPort(parsePortFromMatch(raw.match(/port\s*:\s*(\d+)/), 1), viteFile);
    } catch {
      /* file doesn't exist */
    }
  }

  // next.config.js/mjs
  for (const nextFile of ["next.config.js", "next.config.mjs"]) {
    try {
      const raw = await readFile(join(projectPath, nextFile), "utf-8");
      addPort(parsePortFromMatch(raw.match(/port\s*[=:]\s*(\d+)/), 1), nextFile);
    } catch {
      /* file doesn't exist */
    }
  }

  return ports;
}

/** Get all ports for a project — both runtime and configured */
export async function getProjectPorts(projectPath: string): Promise<PortInfo[]> {
  const [runtime, config] = await Promise.all([
    detectListeningPorts(projectPath),
    parseConfigPorts(projectPath),
  ]);

  return [...runtime, ...config];
}
