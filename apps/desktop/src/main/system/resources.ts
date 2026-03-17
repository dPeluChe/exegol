import * as os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SystemMetrics {
  cpu: {
    usage: number
    cores: number
    model: string
  }
  memory: {
    total: number
    used: number
    free: number
    usagePercent: number
  }
  disk: {
    total: number
    used: number
    free: number
    usagePercent: number
  }
  uptime: number
}

export interface ProjectMetrics {
  projectId: string
  projectName: string
  projectPath: string
  diskUsage: number
  worktreeCount: number
  agentProcesses: {
    pid: number
    cpu: number
    memory: number
  }[]
}

// ─── Background Metrics Collector ───────────────────────────────────────────────

const COLLECT_INTERVAL = 10_000 // 10 seconds

let cachedMetrics: SystemMetrics | null = null
let collectorTimer: ReturnType<typeof setInterval> | null = null
let prevCpuSnapshot: { idle: number; total: number } | null = null

function cpuSnapshot() {
  const cpus = os.cpus()
  let idle = 0
  let total = 0
  for (const cpu of cpus) {
    const { user, nice, sys, idle: idleTime, irq } = cpu.times
    idle += idleTime
    total += user + nice + sys + idleTime + irq
  }
  return { idle, total }
}

/**
 * Collect system metrics without blocking.
 * CPU is calculated from delta since last collection (no sleep/delay).
 */
async function collectMetrics(): Promise<void> {
  const currentCpu = cpuSnapshot()

  // CPU: delta-based, no blocking wait
  let cpuUsage = 0
  if (prevCpuSnapshot) {
    const idleDelta = currentCpu.idle - prevCpuSnapshot.idle
    const totalDelta = currentCpu.total - prevCpuSnapshot.total
    if (totalDelta > 0) {
      cpuUsage = Math.round((1 - idleDelta / totalDelta) * 1000) / 10
    }
  }
  prevCpuSnapshot = currentCpu

  // Memory
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem

  // Disk (async, non-blocking)
  const disk = await getDiskMetrics()

  const cpus = os.cpus()
  cachedMetrics = {
    cpu: {
      usage: Math.max(0, Math.min(100, cpuUsage)),
      cores: cpus.length,
      model: cpus[0]?.model ?? 'Unknown',
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usagePercent: totalMem > 0 ? Math.round((usedMem / totalMem) * 1000) / 10 : 0,
    },
    disk,
    uptime: os.uptime(),
  }
}

/**
 * Start the background metrics collector.
 * Collects every 10 seconds in a non-blocking way.
 */
export function startMetricsCollector(): void {
  if (collectorTimer) return

  // First collection immediately
  collectMetrics().catch(() => {})

  // Then every COLLECT_INTERVAL
  collectorTimer = setInterval(() => {
    collectMetrics().catch(() => {})
  }, COLLECT_INTERVAL)
}

/**
 * Stop the background metrics collector.
 */
export function stopMetricsCollector(): void {
  if (collectorTimer) {
    clearInterval(collectorTimer)
    collectorTimer = null
  }
}

/**
 * Get the latest cached system metrics.
 * Returns immediately — no blocking, no async.
 */
export function getSystemMetrics(): SystemMetrics {
  if (cachedMetrics) return cachedMetrics

  // Return initial snapshot if collector hasn't run yet
  const cpus = os.cpus()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  return {
    cpu: { usage: 0, cores: cpus.length, model: cpus[0]?.model ?? 'Unknown' },
    memory: {
      total: totalMem,
      used: totalMem - freeMem,
      free: freeMem,
      usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10,
    },
    disk: { total: 0, used: 0, free: 0, usagePercent: 0 },
    uptime: os.uptime(),
  }
}

// ─── Disk Metrics ───────────────────────────────────────────────────────────────

async function getDiskMetrics() {
  try {
    const { stdout } = await execFileAsync('df', ['-k', '/'], { timeout: 5_000 })
    const line = stdout.trim().split('\n')[1]
    if (!line) return { total: 0, used: 0, free: 0, usagePercent: 0 }
    const parts = line.split(/\s+/)
    const total = parseInt(parts[1] ?? '0', 10) * 1024
    const used = parseInt(parts[2] ?? '0', 10) * 1024
    const free = parseInt(parts[3] ?? '0', 10) * 1024
    const usagePercent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0
    return { total, used, free, usagePercent }
  } catch {
    return { total: 0, used: 0, free: 0, usagePercent: 0 }
  }
}

// ─── Project Metrics ────────────────────────────────────────────────────────────

async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('du', ['-sk', dirPath], { timeout: 10_000 })
    const kb = parseInt(stdout.split(/\s/)[0] ?? '0', 10)
    return isNaN(kb) ? 0 : kb * 1024
  } catch {
    return 0
  }
}

async function getWorktreeCount(dirPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: dirPath,
      timeout: 5_000,
    })
    return stdout.split('\n').filter((l) => l.startsWith('worktree ')).length
  } catch {
    return 1
  }
}

export async function getProjectMetrics(
  projectPath: string,
  projectId: string,
  projectName: string
): Promise<ProjectMetrics> {
  const [diskUsage, worktreeCount] = await Promise.all([
    getDirectorySize(projectPath),
    getWorktreeCount(projectPath),
  ])

  return {
    projectId,
    projectName,
    projectPath,
    diskUsage,
    worktreeCount,
    agentProcesses: [],
  }
}
