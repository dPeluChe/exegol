import { execFile } from "node:child_process";
import * as os from "node:os";
import { promisify } from "node:util";
import { BrowserWindow } from "electron";

const execFileAsync = promisify(execFile);

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SystemMetrics {
  cpu: {
    usage: number;
    cores: number;
    model: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  uptime: number;
}

export interface ProjectMetrics {
  projectId: string;
  projectName: string;
  projectPath: string;
  diskUsage: number;
  worktreeCount: number;
  agentProcesses: {
    pid: number;
    cpu: number;
    memory: number;
  }[];
}

// ─── Background Metrics Collector ───────────────────────────────────────────────

const COLLECT_INTERVAL = 10_000; // 10 seconds

let cachedMetrics: SystemMetrics | null = null;
let collectorTimer: ReturnType<typeof setInterval> | null = null;
let prevCpuSnapshot: { idle: number; total: number } | null = null;

// ─── Metrics history (last 30 data points for sparkline charts) ───────────

const MAX_HISTORY_POINTS = 30;

export interface MetricsSnapshot {
  cpu: number;
  memoryPercent: number;
  diskPercent: number;
  timestamp: number;
}

const metricsHistory: MetricsSnapshot[] = [];

/** Get the last N metrics snapshots for sparkline charts */
export function getMetricsHistory(): MetricsSnapshot[] {
  return metricsHistory;
}

/** Broadcast metrics to all renderer windows */
function broadcastMetrics(metrics: SystemMetrics): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("metrics:update", metrics);
  }
}

function cpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const { user, nice, sys, idle: idleTime, irq } = cpu.times;
    idle += idleTime;
    total += user + nice + sys + idleTime + irq;
  }
  return { idle, total };
}

/**
 * Collect system metrics without blocking.
 * CPU is calculated from delta since last collection (no sleep/delay).
 */
async function collectMetrics(): Promise<void> {
  const currentCpu = cpuSnapshot();

  // CPU: delta-based, no blocking wait
  let cpuUsage = 0;
  if (prevCpuSnapshot) {
    const idleDelta = currentCpu.idle - prevCpuSnapshot.idle;
    const totalDelta = currentCpu.total - prevCpuSnapshot.total;
    if (totalDelta > 0) {
      cpuUsage = Math.round((1 - idleDelta / totalDelta) * 1000) / 10;
    }
  }
  prevCpuSnapshot = currentCpu;

  // Memory — use vm_stat on macOS for accurate "available" memory
  // os.freemem() on macOS only shows truly free pages, ignoring
  // inactive/purgeable/cached memory that apps can reclaim
  const memory = await getMemoryMetrics();

  // Disk (async, non-blocking)
  const disk = await getDiskMetrics();

  const cpus = os.cpus();
  cachedMetrics = {
    cpu: {
      usage: Math.max(0, Math.min(100, cpuUsage)),
      cores: cpus.length,
      model: cpus[0]?.model ?? "Unknown",
    },
    memory,
    disk,
    uptime: os.uptime(),
  };

  // Track history for sparkline charts
  metricsHistory.push({
    cpu: cachedMetrics.cpu.usage,
    memoryPercent: cachedMetrics.memory.usagePercent,
    diskPercent: cachedMetrics.disk.usagePercent,
    timestamp: Date.now(),
  });
  if (metricsHistory.length > MAX_HISTORY_POINTS) {
    metricsHistory.shift();
  }

  // Push to renderer
  broadcastMetrics(cachedMetrics);
}

/**
 * Start the background metrics collector.
 * Collects every 10 seconds in a non-blocking way.
 */
export function startMetricsCollector(): void {
  if (collectorTimer) return;

  // First collection immediately
  collectMetrics().catch(() => {});

  // Then every COLLECT_INTERVAL
  collectorTimer = setInterval(() => {
    collectMetrics().catch(() => {});
  }, COLLECT_INTERVAL);
}

/**
 * Stop the background metrics collector.
 */
export function stopMetricsCollector(): void {
  if (collectorTimer) {
    clearInterval(collectorTimer);
    collectorTimer = null;
  }
}

/**
 * Get the latest cached system metrics.
 * Returns immediately — no blocking, no async.
 */
export function getSystemMetrics(): SystemMetrics {
  if (cachedMetrics) return cachedMetrics;

  // Return placeholder if collector hasn't run yet (first real data comes in ~10s)
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  return {
    cpu: { usage: 0, cores: cpus.length, model: cpus[0]?.model ?? "Unknown" },
    memory: {
      total: totalMem,
      used: 0,
      free: totalMem,
      usagePercent: 0,
    },
    disk: { total: 0, used: 0, free: 0, usagePercent: 0 },
    uptime: os.uptime(),
  };
}

// ─── Memory Metrics ─────────────────────────────────────────────────────────────

/**
 * Get accurate memory metrics.
 * On macOS, os.freemem() only shows truly free pages. macOS aggressively caches
 * files in memory, so "free" appears near zero even with plenty of available RAM.
 * We use vm_stat to get free + inactive + purgeable as "available" memory,
 * which matches what Activity Monitor and CleanMyMac show.
 */
async function getMemoryMetrics(): Promise<SystemMetrics["memory"]> {
  const total = os.totalmem();

  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("vm_stat", [], { timeout: 3_000 });
      // Parse page size (usually 16384 on Apple Silicon, 4096 on Intel)
      const pageSizeMatch = stdout.match(/page size of (\d+) bytes/);
      const pageSize = pageSizeMatch?.[1] ? parseInt(pageSizeMatch[1], 10) : 16384;

      // Parse page counts
      const parse = (label: string): number => {
        const match = stdout.match(new RegExp(`${label}:\\s+(\\d+)`));
        return match?.[1] ? parseInt(match[1], 10) * pageSize : 0;
      };

      const free = parse("Pages free");
      const inactive = parse("Pages inactive");
      const purgeable = parse("Pages purgeable");
      const speculative = parse("Pages speculative");

      // Available = free + inactive + purgeable + speculative
      const available = free + inactive + purgeable + speculative;
      const used = total - available;

      return {
        total,
        used: Math.max(0, used),
        free: available,
        usagePercent: total > 0 ? Math.round((Math.max(0, used) / total) * 1000) / 10 : 0,
      };
    } catch {
      // Fallback to os.freemem() if vm_stat fails
    }
  }

  // Linux / Windows / fallback
  const free = os.freemem();
  const used = total - free;
  return {
    total,
    used,
    free,
    usagePercent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
  };
}

// ─── Disk Metrics ───────────────────────────────────────────────────────────────

async function getDiskMetrics() {
  try {
    const { stdout } = await execFileAsync("df", ["-k", "/"], { timeout: 5_000 });
    const line = stdout.trim().split("\n")[1];
    if (!line) return { total: 0, used: 0, free: 0, usagePercent: 0 };
    const parts = line.split(/\s+/);
    const total = parseInt(parts[1] ?? "0", 10) * 1024;
    const used = parseInt(parts[2] ?? "0", 10) * 1024;
    const free = parseInt(parts[3] ?? "0", 10) * 1024;
    const usagePercent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
    return { total, used, free, usagePercent };
  } catch {
    return { total: 0, used: 0, free: 0, usagePercent: 0 };
  }
}

// ─── Project Metrics ────────────────────────────────────────────────────────────

async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("du", ["-sk", dirPath], { timeout: 10_000 });
    const kb = parseInt(stdout.split(/\s/)[0] ?? "0", 10);
    return Number.isNaN(kb) ? 0 : kb * 1024;
  } catch {
    return 0;
  }
}

async function getWorktreeCount(dirPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], {
      cwd: dirPath,
      timeout: 5_000,
    });
    return stdout.split("\n").filter((l) => l.startsWith("worktree ")).length;
  } catch {
    return 1;
  }
}

/**
 * Find direct child PIDs for a single parent PID.
 * node-pty spawns `$SHELL -ilc "claude ..."` — the stored PID is the shell,
 * not the real CLI tool.
 */
async function getChildPids(parentPid: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-P", String(parentPid)], {
      timeout: 2_000,
    });
    return stdout
      .trim()
      .split("\n")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => n > 0);
  } catch {
    // pgrep exits non-zero if no children found
    return [];
  }
}

async function getAgentProcessMetrics(
  pids: number[],
): Promise<{ pid: number; cpu: number; memory: number }[]> {
  if (pids.length === 0) return [];

  try {
    // For each agent shell PID, find its child processes (the real CLI tool)
    const pidToChildren = new Map<number, number[]>();
    const allPids = new Set(pids);

    await Promise.all(
      pids.map(async (parentPid) => {
        const children = await getChildPids(parentPid);
        pidToChildren.set(parentPid, children);
        for (const c of children) allPids.add(c);
      }),
    );

    // Get metrics for all PIDs in one ps call
    const pidList = Array.from(allPids).join(",");
    const { stdout } = await execFileAsync("ps", ["-o", "pid=,pcpu=,rss=", "-p", pidList], {
      timeout: 3_000,
    });

    const metricsMap = new Map<number, { cpu: number; memory: number }>();
    for (const line of stdout.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const pid = parseInt(parts[0] ?? "0", 10);
      const cpu = parseFloat(parts[1] ?? "0");
      const rss = parseInt(parts[2] ?? "0", 10) * 1024; // RSS in KB → bytes
      if (pid > 0) {
        metricsMap.set(pid, { cpu, memory: rss });
      }
    }

    // Aggregate: for each agent PID, sum shell + its specific children
    const results: { pid: number; cpu: number; memory: number }[] = [];
    for (const parentPid of pids) {
      let totalCpu = 0;
      let totalMem = 0;

      const self = metricsMap.get(parentPid);
      if (self) {
        totalCpu += self.cpu;
        totalMem += self.memory;
      }

      for (const childPid of pidToChildren.get(parentPid) ?? []) {
        const child = metricsMap.get(childPid);
        if (child) {
          totalCpu += child.cpu;
          totalMem += child.memory;
        }
      }

      results.push({ pid: parentPid, cpu: totalCpu, memory: totalMem });
    }
    return results;
  } catch {
    return [];
  }
}

export async function getProjectMetrics(
  projectPath: string,
  projectId: string,
  projectName: string,
  agentPids: number[] = [],
): Promise<ProjectMetrics> {
  const [diskUsage, worktreeCount, agentProcesses] = await Promise.all([
    getDirectorySize(projectPath),
    getWorktreeCount(projectPath),
    getAgentProcessMetrics(agentPids),
  ]);

  return {
    projectId,
    projectName,
    projectPath,
    diskUsage,
    worktreeCount,
    agentProcesses,
  };
}
