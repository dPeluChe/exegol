import { execFile } from "node:child_process";
import { readFile, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { logger } from "../lib/logger";
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

let lsofOffLogged = false;

/** Windows has no lsof (and no other process's cwd): port detection is off there, said once */
function lsofMissing(): boolean {
  if (process.platform !== "win32") return false;
  if (!lsofOffLogged) {
    lsofOffLogged = true;
    logger.info("[Ports] Port and dev server detection is off on Windows");
  }
  return true;
}

async function scanProcessCwds(pids: number[]): Promise<Map<number, string>> {
  const cwds = process.platform === "linux" ? await readProcCwds(pids) : new Map<number, string>();
  const rest = pids.filter((pid) => !cwds.has(pid));
  if (rest.length === 0 || lsofMissing()) return cwds;
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
  if (lsofMissing()) return [];
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

/** package.json scripts: --port NNNN or -p NNNN */
function scriptPorts(raw: string): (number | null)[] {
  const pkg = JSON.parse(raw);
  return Object.values(pkg.scripts ?? {}).flatMap((script) =>
    ((script as string).match(/(?:--port|-p)\s+(\d+)/g) ?? []).map((m) =>
      parsePortFromMatch(m.match(/(\d+)/), 1),
    ),
  );
}

const envPort = (raw: string) => [parsePortFromMatch(raw.match(/^PORT\s*=\s*(\d+)/m), 1)];
const vitePort = (raw: string) => [parsePortFromMatch(raw.match(/port\s*:\s*(\d+)/), 1)];
const nextPort = (raw: string) => [parsePortFromMatch(raw.match(/port\s*[=:]\s*(\d+)/), 1)];

/** The files read for expected ports, and how; the cache signature covers the same list */
const CONFIG_FILES: { file: string; ports: (raw: string) => (number | null)[] }[] = [
  { file: "package.json", ports: scriptPorts },
  { file: ".env", ports: envPort },
  { file: ".env.local", ports: envPort },
  { file: "vite.config.ts", ports: vitePort },
  { file: "vite.config.js", ports: vitePort },
  { file: "next.config.js", ports: nextPort },
  { file: "next.config.mjs", ports: nextPort },
];

/** Each config file's mtime and size ("-" when missing): equal means the ports did not change */
export async function configSignature(
  projectPath: string,
  statFile: (path: string) => Promise<{ mtimeMs: number; size: number }> = stat,
): Promise<string> {
  const parts = await Promise.all(
    CONFIG_FILES.map(({ file }) =>
      statFile(join(projectPath, file)).then(
        (s) => `${s.mtimeMs}:${s.size}`,
        () => "-",
      ),
    ),
  );
  return parts.join("|");
}

const configPorts = new AsyncLruCache<string, ConfiguredPort[]>(64);

/** Every sidebar row asks every 10 s: the files are parsed again only after one changes */
async function cachedConfigPorts(projectPath: string): Promise<ConfiguredPort[]> {
  const signature = await configSignature(projectPath);
  return configPorts.getOrCompute(`${projectPath}|${signature}`, () =>
    parseConfigPorts(projectPath),
  );
}

/** Parse common config files for expected port numbers */
async function parseConfigPorts(projectPath: string): Promise<ConfiguredPort[]> {
  const ports: ConfiguredPort[] = [];
  const seen = new Set<number>();
  for (const { file, ports: read } of CONFIG_FILES) {
    try {
      const raw = await readFile(join(projectPath, file), "utf-8");
      for (const port of read(raw)) {
        if (port && !seen.has(port)) {
          seen.add(port);
          ports.push({ port, source: "config", file });
        }
      }
    } catch {
      /* missing or unreadable */
    }
  }
  return ports;
}

/** Get all ports for a project — both runtime and configured */
export async function getProjectPorts(projectPath: string): Promise<PortInfo[]> {
  const [runtime, config] = await Promise.all([
    detectListeningPorts(projectPath),
    cachedConfigPorts(projectPath),
  ]);

  return [...runtime, ...config];
}
