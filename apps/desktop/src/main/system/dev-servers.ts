import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import { type DevServer, LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import { logger } from "../lib/logger";
import { isProcessAlive } from "../terminal/pty-sidecar-discovery";
import { getProcessCwds, isInside, listTcpListeners } from "./ports";

const execFileAsync = promisify(execFile);

/** `ps` etime: [[dd-]hh:]mm:ss */
export function parseEtime(etime: string): number | null {
  const m = etime.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return null;
  const [, d, h, min, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s);
}

/** Deepest project folder that holds `cwd` */
export function matchProject<T extends { path: string }>(
  cwd: string | null,
  projects: T[],
): T | null {
  let best: T | null = null;
  for (const p of projects) {
    if (isInside(cwd, p.path) && (!best || p.path.length > best.path.length)) best = p;
  }
  return best;
}

/** The pid itself or its first ancestor that is in `targets` */
export function findAncestorIn(
  pid: number,
  parentOf: Map<number, number>,
  targets: Set<number>,
): number | null {
  let current: number | undefined = pid;
  for (let depth = 0; current && current > 1 && depth < 16; depth++) {
    if (targets.has(current)) return current;
    current = parentOf.get(current);
  }
  return null;
}

interface ProcTable {
  parentOf: Map<number, number>;
  etimeOf: Map<number, string>;
  /** Executable name: lsof cuts names at 9 chars ("ControlCe") */
  nameOf: Map<number, string>;
}

async function readProcTable(): Promise<ProcTable> {
  const table: ProcTable = { parentOf: new Map(), etimeOf: new Map(), nameOf: new Map() };
  const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,etime=,comm="], {
    timeout: 5000,
  });
  for (const line of stdout.split("\n")) {
    // comm last: it may contain spaces
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    table.parentOf.set(pid, Number(m[2]));
    table.etimeOf.set(pid, m[3] ?? "");
    table.nameOf.set(pid, m[4]?.split("/").pop() ?? "");
  }
  return table;
}

function liveAgents(db: Database.Database) {
  const statuses = [...LIVE_STATUSES];
  return db
    .prepare(
      `SELECT id, project_id, cli_type, alias, pid FROM agents
       WHERE pid IS NOT NULL AND status IN (${statuses.map(() => "?").join(",")})`,
    )
    .all(...statuses) as {
    id: string;
    project_id: string;
    cli_type: string;
    alias: string | null;
    pid: number;
  }[];
}

/**
 * Every TCP port the user's own processes listen on, with where each one came
 * from: the project folder it runs in and the Exegol terminal that started it.
 * A dev server left behind by a closed pane or an old session shows up here
 * with no terminal, which is what "hung" looks like.
 */
export async function listDevServers(db: Database.Database): Promise<DevServer[]> {
  const listeners = await listTcpListeners(String(userInfo().uid));
  if (listeners.length === 0) return [];

  const portsOf = new Map<number, Set<number>>();
  const portOwners = new Map<number, number>();
  for (const l of listeners) {
    const set = portsOf.get(l.pid) ?? new Set<number>();
    if (!set.has(l.port)) portOwners.set(l.port, (portOwners.get(l.port) ?? 0) + 1);
    set.add(l.port);
    portsOf.set(l.pid, set);
  }
  const pids = [...portsOf.keys()];
  const lsofName = new Map(listeners.map((l) => [l.pid, l.process]));

  let procs: ProcTable = { parentOf: new Map(), etimeOf: new Map(), nameOf: new Map() };
  const commandOf = new Map<number, string>();
  try {
    procs = await readProcTable();
    const { stdout } = await execFileAsync("ps", ["-o", "pid=,command=", "-p", pids.join(",")], {
      timeout: 5000,
    });
    for (const line of stdout.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (m?.[1] && m[2]) commandOf.set(Number(m[1]), m[2]);
    }
  } catch (err) {
    logger.warn("[DevServers] ps failed:", err);
  }

  const projects = db.prepare("SELECT id, name, path FROM projects").all() as {
    id: string;
    name: string;
    path: string;
  }[];
  const agents = liveAgents(db);
  const agentByPid = new Map(agents.map((a) => [a.pid, a]));
  const cwds = await getProcessCwds(pids);

  return pids
    .map((pid): DevServer => {
      const ports = [...(portsOf.get(pid) ?? [])].sort((a, b) => a - b);
      const cwd = cwds.get(pid) ?? null;
      const project = matchProject(cwd, projects);
      const ancestor = findAncestorIn(pid, procs.parentOf, new Set(agentByPid.keys()));
      const agent = ancestor ? agentByPid.get(ancestor) : undefined;
      const etime = procs.etimeOf.get(pid);
      return {
        pid,
        ports,
        process: procs.nameOf.get(pid) || lsofName.get(pid) || "?",
        command: commandOf.get(pid) ?? "",
        uptimeSeconds: etime ? parseEtime(etime) : null,
        cwd,
        project: project ? { id: project.id, name: project.name } : null,
        agent: agent
          ? {
              id: agent.id,
              projectId: agent.project_id,
              cliType: agent.cli_type,
              alias: agent.alias,
            }
          : null,
        conflict: ports.some((p) => (portOwners.get(p) ?? 0) > 1),
      };
    })
    .sort(
      (a, b) => Number(!!b.project) - Number(!!a.project) || (a.ports[0] ?? 0) - (b.ports[0] ?? 0),
    );
}

async function startTime(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)], {
      timeout: 3000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Stop a listed server: SIGTERM, then SIGKILL if it is still up after 3s.
 * Refused unless the pid listens on TCP right now under this user, so the
 * renderer cannot turn this into "kill any process". Also refused: Exegol
 * itself and its parents (the dev server that runs it), and an agent's own
 * PTY process, which must go through the agent's Stop so its row is closed.
 */
export async function killDevServer(
  db: Database.Database,
  pid: number,
): Promise<{ stopped: boolean; forced: boolean }> {
  const uid = String(userInfo().uid);
  const listening = (await listTcpListeners(uid)).some((l) => l.pid === pid);
  if (!listening) throw new Error(`Process ${pid} is not listening on a port`);

  const { parentOf } = await readProcTable();
  const ownChain = new Set<number>();
  for (let p: number | undefined = process.pid; p && p > 1; p = parentOf.get(p)) ownChain.add(p);
  if (ownChain.has(pid)) throw new Error("That process runs Exegol itself");
  if (liveAgents(db).some((a) => a.pid === pid)) {
    throw new Error("That is an agent's own process: stop the agent instead");
  }

  const started = await startTime(pid);
  process.kill(pid, "SIGTERM");
  for (let waited = 0; waited < 3000; waited += 100) {
    await new Promise((r) => setTimeout(r, 100));
    if (!isProcessAlive(pid)) return { stopped: true, forced: false };
  }
  // A reused pid is a different process: never SIGKILL that
  if (started && (await startTime(pid)) !== started) return { stopped: true, forced: false };
  process.kill(pid, "SIGKILL");
  await new Promise((r) => setTimeout(r, 200));
  return { stopped: !isProcessAlive(pid), forced: true };
}
