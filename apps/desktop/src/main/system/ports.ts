import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DetectedPort {
  port: number;
  pid: number;
  process: string;
  source: "runtime";
}

export interface ConfiguredPort {
  port: number;
  source: "config";
  file: string;
}

export type PortInfo = DetectedPort | ConfiguredPort;

/** The cwd of each pid, from one lsof call (it used to be one lsof per pid) */
export async function getProcessCwds(pids: number[]): Promise<Map<number, string>> {
  const cwds = new Map<number, string>();
  if (pids.length === 0) return cwds;
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-Fpn"], {
      timeout: 5000,
    }));
  } catch (err) {
    // lsof exits 1 when one of the pids is gone; the rest still printed
    stdout = (err as { stdout?: string }).stdout ?? "";
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
export function parseLsofListenLine(
  line: string,
): { port: number; pid: number; process: string } | null {
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

/** TCP listeners, one entry per pid:port; `uid` limits them to that user's processes */
export async function listTcpListeners(
  uid?: string,
): Promise<{ port: number; pid: number; process: string }[]> {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync(
      "lsof",
      [...(uid ? ["-a", "-u", uid] : []), "-iTCP", "-sTCP:LISTEN", "-P", "-n"],
      { timeout: 5000 },
    ));
  } catch (err) {
    // lsof exits 1 when nothing matches
    stdout = (err as { stdout?: string }).stdout ?? "";
  }
  const seen = new Set<string>();
  const entries: { port: number; pid: number; process: string }[] = [];
  for (const line of stdout.split("\n").slice(1)) {
    const entry = parseLsofListenLine(line);
    if (!entry || seen.has(`${entry.pid}:${entry.port}`)) continue;
    seen.add(`${entry.pid}:${entry.port}`);
    entries.push(entry);
  }
  return entries;
}

// Each sidebar project row polls its ports: N rows ran the same two lsof scans N times
const SCAN_TTL_MS = 3_000;
let scan: {
  at: number;
  result: Promise<{
    listeners: Awaited<ReturnType<typeof listTcpListeners>>;
    cwds: Map<number, string>;
  }>;
} | null = null;

function scanListeners() {
  if (scan && Date.now() - scan.at < SCAN_TTL_MS) return scan.result;
  const result = listTcpListeners().then(async (listeners) => ({
    listeners,
    cwds: await getProcessCwds([...new Set(listeners.map((l) => l.pid))]),
  }));
  scan = { at: Date.now(), result };
  return result;
}

/** Listening TCP ports whose process runs inside projectPath */
async function detectListeningPorts(projectPath: string): Promise<DetectedPort[]> {
  const { listeners, cwds } = await scanListeners();
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
