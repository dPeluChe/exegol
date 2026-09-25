import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import type { DevServer } from "@exegol/shared";
import type Database from "libsql";
import { logger } from "../lib/logger";
import { getProcessCwd, parseLsofListenLine } from "./ports";

const execFileAsync = promisify(execFile);

/** `ps` etime: [[dd-]hh:]mm:ss */
export function parseEtime(etime: string): number | null {
  const m = etime.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return null;
  const [, d, h, min, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s);
}

/** Longest project folder that holds `cwd` (path boundary, not a prefix of a name) */
export function matchProject<T extends { path: string }>(
  cwd: string | null,
  projects: T[],
): T | null {
  if (!cwd) return null;
  let best: T | null = null;
  for (const p of projects) {
    const inside = cwd === p.path || cwd.startsWith(`${p.path}/`);
    if (inside && (!best || p.path.length > best.path.length)) best = p;
  }
  return best;
}

/** First ancestor (or the pid itself) that is an Exegol agent's PTY process */
export function findAgentAncestor(
  pid: number,
  parentOf: Map<number, number>,
  agentPids: Set<number>,
): number | null {
  let current: number | undefined = pid;
  for (let depth = 0; current && current > 1 && depth < 16; depth++) {
    if (agentPids.has(current)) return current;
    current = parentOf.get(current);
  }
  return null;
}

const LIVE = "('running', 'spawning', 'waiting_input', 'paused')";

/**
 * Every TCP port the user's own processes listen on, with where each one came
 * from: the project folder it runs in and the Exegol terminal that started it.
 * A dev server left behind by a closed pane or an old session shows up here
 * with no agent, which is what "hung" looks like.
 */
export async function listDevServers(db: Database.Database): Promise<DevServer[]> {
  const uid = String(userInfo().uid);
  let lsofOut = "";
  try {
    ({ stdout: lsofOut } = await execFileAsync(
      "lsof",
      ["-a", "-u", uid, "-iTCP", "-sTCP:LISTEN", "-P", "-n"],
      { timeout: 5000 },
    ));
  } catch (err) {
    // lsof exits 1 when nothing matches
    lsofOut = (err as { stdout?: string }).stdout ?? "";
  }

  const byPid = new Map<number, { process: string; ports: Set<number> }>();
  for (const line of lsofOut.split("\n").slice(1)) {
    const entry = parseLsofListenLine(line);
    if (!entry) continue;
    const row = byPid.get(entry.pid) ?? { process: entry.process, ports: new Set<number>() };
    row.ports.add(entry.port);
    byPid.set(entry.pid, row);
  }
  if (byPid.size === 0) return [];

  const pids = [...byPid.keys()];
  const parentOf = new Map<number, number>();
  const etimeOf = new Map<number, string>();
  const commandOf = new Map<number, string>();
  // lsof cuts names at 9 chars ("ControlCe"); ps comm is the executable's full path
  const nameOf = new Map<number, string>();
  try {
    const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,etime="], {
      timeout: 5000,
    });
    for (const line of stdout.split("\n")) {
      const [pid, ppid, etime] = line.trim().split(/\s+/);
      if (!pid || !ppid) continue;
      parentOf.set(Number(pid), Number(ppid));
      if (etime) etimeOf.set(Number(pid), etime);
    }
    const { stdout: cmds } = await execFileAsync(
      "ps",
      ["-o", "pid=,command=", "-p", pids.join(",")],
      {
        timeout: 5000,
      },
    );
    for (const line of cmds.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (m?.[1] && m[2]) commandOf.set(Number(m[1]), m[2]);
    }
    const { stdout: comms } = await execFileAsync(
      "ps",
      ["-o", "pid=,comm=", "-p", pids.join(",")],
      {
        timeout: 5000,
      },
    );
    for (const line of comms.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (m?.[1] && m[2]) nameOf.set(Number(m[1]), m[2].split("/").pop() ?? m[2]);
    }
  } catch (err) {
    logger.warn("[DevServers] ps failed:", err);
  }

  const projects = db.prepare("SELECT id, name, path FROM projects").all() as {
    id: string;
    name: string;
    path: string;
  }[];
  const agents = db
    .prepare(
      `SELECT id, project_id, cli_type, alias, pid FROM agents WHERE pid IS NOT NULL AND status IN ${LIVE}`,
    )
    .all() as {
    id: string;
    project_id: string;
    cli_type: string;
    alias: string | null;
    pid: number;
  }[];
  const agentByPid = new Map(agents.map((a) => [a.pid, a]));
  const agentPids = new Set(agentByPid.keys());

  const portOwners = new Map<number, number>();
  for (const { ports } of byPid.values()) {
    for (const port of ports) portOwners.set(port, (portOwners.get(port) ?? 0) + 1);
  }

  const cwds = await Promise.all(pids.map((pid) => getProcessCwd(pid)));

  return pids
    .map((pid, i): DevServer => {
      const row = byPid.get(pid);
      const ports = [...(row?.ports ?? [])].sort((a, b) => a - b);
      const cwd = cwds[i] ?? null;
      const project = matchProject(cwd, projects);
      const ancestor = findAgentAncestor(pid, parentOf, agentPids);
      const agent = ancestor ? agentByPid.get(ancestor) : undefined;
      const etime = etimeOf.get(pid);
      return {
        pid,
        ports,
        process: nameOf.get(pid) ?? row?.process ?? "?",
        command: commandOf.get(pid) ?? row?.process ?? "",
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

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop a listed server: SIGTERM, then SIGKILL if it is still up after 3s.
 * Only a pid that is listening right now under this user can be targeted, so
 * the renderer cannot turn this into "kill any process".
 */
export async function killDevServer(
  db: Database.Database,
  pid: number,
): Promise<{ stopped: boolean; forced: boolean }> {
  const listed = (await listDevServers(db)).some((s) => s.pid === pid);
  if (!listed || pid === process.pid) throw new Error(`Process ${pid} is not a listed dev server`);
  process.kill(pid, "SIGTERM");
  for (let waited = 0; waited < 3000; waited += 100) {
    await new Promise((r) => setTimeout(r, 100));
    if (!isAlive(pid)) return { stopped: true, forced: false };
  }
  process.kill(pid, "SIGKILL");
  await new Promise((r) => setTimeout(r, 200));
  return { stopped: !isAlive(pid), forced: true };
}
