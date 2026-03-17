import * as os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface SystemMetrics {
  cpu: {
    usage: number // 0-100 percentage
    cores: number
    model: string
  }
  memory: {
    total: number // bytes
    used: number // bytes
    free: number // bytes
    usagePercent: number // 0-100
  }
  disk: {
    total: number // bytes
    used: number // bytes
    free: number // bytes
    usagePercent: number // 0-100
  }
  uptime: number // seconds
}

export interface ProjectMetrics {
  projectId: string
  projectName: string
  projectPath: string
  diskUsage: number // bytes used by project directory
  worktreeCount: number
  agentProcesses: {
    pid: number
    cpu: number // percentage
    memory: number // bytes (RSS)
  }[]
}

/**
 * Compute CPU usage by comparing idle/total deltas across a short sample window.
 */
async function getCpuUsage(): Promise<number> {
  const snapshot = () => {
    const cpus = os.cpus()
    let idleTotal = 0
    let total = 0
    for (const cpu of cpus) {
      const { user, nice, sys, idle, irq } = cpu.times
      idleTotal += idle
      total += user + nice + sys + idle + irq
    }
    return { idle: idleTotal, total }
  }

  const a = snapshot()
  await new Promise((r) => setTimeout(r, 200))
  const b = snapshot()

  const idleDelta = b.idle - a.idle
  const totalDelta = b.total - a.total
  if (totalDelta === 0) return 0
  return Math.round(((1 - idleDelta / totalDelta) * 100 + Number.EPSILON) * 10) / 10
}

/**
 * Parse `df -k /` output to get disk usage for the root volume.
 */
async function getDiskMetrics(): Promise<{
  total: number
  used: number
  free: number
  usagePercent: number
}> {
  try {
    const { stdout } = await execFileAsync('df', ['-k', '/'], { timeout: 5_000 })
    const lines = stdout.trim().split('\n')
    // Second line contains the data
    const line = lines[1]
    if (!line) return { total: 0, used: 0, free: 0, usagePercent: 0 }
    const parts = line.split(/\s+/)
    // df -k columns: Filesystem 1K-blocks Used Available Capacity ...
    const totalKB = parseInt(parts[1] ?? '0', 10)
    const usedKB = parseInt(parts[2] ?? '0', 10)
    const freeKB = parseInt(parts[3] ?? '0', 10)
    const total = totalKB * 1024
    const used = usedKB * 1024
    const free = freeKB * 1024
    const usagePercent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0
    return { total, used, free, usagePercent }
  } catch {
    return { total: 0, used: 0, free: 0, usagePercent: 0 }
  }
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const [cpuUsage, disk] = await Promise.all([getCpuUsage(), getDiskMetrics()])

  const cpus = os.cpus()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem

  return {
    cpu: {
      usage: cpuUsage,
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
 * Get the disk usage of a directory via `du -sk`.
 * Returns 0 on failure or timeout.
 */
async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('du', ['-sk', dirPath], { timeout: 10_000 })
    const kb = parseInt(stdout.split(/\s/)[0] ?? '0', 10)
    return isNaN(kb) ? 0 : kb * 1024
  } catch {
    return 0
  }
}

/**
 * Count git worktrees for a repo path.
 */
async function getWorktreeCount(dirPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: dirPath,
      timeout: 5_000,
    })
    // Each worktree block starts with "worktree "
    const lines = stdout.split('\n').filter((l) => l.startsWith('worktree '))
    return lines.length
  } catch {
    return 1 // assume at least the main worktree
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
