import type { IPty } from 'node-pty'
import * as pty from 'node-pty'
import type Database from 'libsql'
import type { Agent, AgentCreate, AgentCliConfig } from '@exegol/shared'
import { DEFAULT_SETTINGS } from '@exegol/shared'
import {
  updateAgentStatus,
  stopAgent,
  setAgentPid,
  getAgent,
} from '../db/queries'
import { AgentStatusParser } from './status-parser'
import { BrowserWindow } from 'electron'
import { execSync } from 'child_process'

/**
 * Get the full user shell PATH. Electron doesn't inherit the full PATH
 * from the user's shell on macOS/Linux.
 */
function getShellPath(): string {
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const result = execSync(`${shell} -ilc 'echo $PATH'`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()
    return result || process.env.PATH || ''
  } catch {
    return process.env.PATH || ''
  }
}

let resolvedPath: string | null = null
function getFullPath(): string {
  if (!resolvedPath) {
    resolvedPath = getShellPath()
  }
  return resolvedPath
}

let instance: AgentManager | null = null

export function getAgentManager(): AgentManager {
  if (!instance) {
    instance = new AgentManager()
  }
  return instance
}

export class AgentManager {
  private processes: Map<string, IPty> = new Map()
  private statusParsers: Map<string, AgentStatusParser> = new Map()

  /**
   * Spawn an agent process with the configured CLI tool.
   */
  async spawn(db: Database.Database, agent: Agent, config: AgentCreate): Promise<void> {
    const cliConfig = this.resolveCliConfig(agent.cliType)
    if (!cliConfig) {
      throw new Error(`No CLI configuration found for agent type: ${agent.cliType}`)
    }

    // Resolve the project path for the working directory
    const project = db
      .prepare('SELECT path FROM projects WHERE id = ?')
      .get(agent.projectId) as { path: string } | undefined

    if (!project) {
      throw new Error(`Project ${agent.projectId} not found`)
    }

    const cwd = project.path

    // Build the full command string to run through the user's shell
    const cmdParts = [cliConfig.command, ...cliConfig.args]
    if (agent.taskDescription) {
      // Shell-escape the task description
      const escaped = agent.taskDescription.replace(/'/g, "'\\''")
      cmdParts.push(`'${escaped}'`)
    }
    const fullCommand = cmdParts.join(' ')

    // Spawn through the user's login shell so PATH, nvm, etc. are resolved
    const userShell = process.env.SHELL || '/bin/zsh'
    console.log('[AgentManager] Spawning:', { userShell, fullCommand, cwd, shellExists: require('fs').existsSync(userShell) })
    const proc = pty.spawn(userShell, ['-ilc', fullCommand], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: {
        ...process.env,
        ...cliConfig.env,
        TERM: 'xterm-256color',
      } as Record<string, string>,
    })

    this.processes.set(agent.id, proc)

    // Update DB with PID and running status
    setAgentPid(db, agent.id, proc.pid)
    updateAgentStatus(db, agent.id, 'running')

    // Create status parser
    const parser = new AgentStatusParser(agent.id, agent.cliType)
    this.statusParsers.set(agent.id, parser)

    // Listen to stdout for status updates and forward to renderer
    proc.onData((data: string) => {
      // Forward terminal data to all renderer windows
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        win.webContents.send('terminal:data', agent.id, data)
      }

      // Parse for status updates
      const statusUpdate = parser.parse(data)
      if (statusUpdate) {
        if (statusUpdate.status) {
          updateAgentStatus(db, agent.id, statusUpdate.status, statusUpdate.currentStep)
        } else if (statusUpdate.currentStep) {
          updateAgentStatus(db, agent.id, 'running', statusUpdate.currentStep)
        }
      }
    })

    // Handle process exit
    proc.onExit(({ exitCode }) => {
      this.processes.delete(agent.id)
      this.statusParsers.delete(agent.id)

      const currentAgent = getAgent(db, agent.id)
      if (currentAgent && currentAgent.status !== 'completed' && currentAgent.status !== 'failed') {
        const finalStatus = exitCode === 0 ? 'completed' : 'failed'
        stopAgent(db, agent.id, finalStatus)
      }
    })
  }

  /**
   * Stop a running agent process gracefully.
   */
  async stop(db: Database.Database, agentId: string): Promise<void> {
    const proc = this.processes.get(agentId)

    if (proc) {
      // Send SIGTERM first for graceful shutdown
      proc.kill()

      // Wait up to 5 seconds for the process to exit, then force kill.
      // The existing onExit listener from spawn() handles cleanup.
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.processes.has(agentId)) {
            clearInterval(checkInterval)
            clearTimeout(timeout)
            resolve()
          }
        }, 100)

        const timeout = setTimeout(() => {
          clearInterval(checkInterval)
          // Force kill if still running
          try {
            process.kill(proc.pid, 'SIGKILL')
          } catch {
            // Process already exited
          }
          resolve()
        }, 5000)
      })
    } else {
      // No process found but ensure DB is updated
      stopAgent(db, agentId, 'completed')
    }
  }

  /**
   * Get the PTY process for an agent (for terminal forwarding).
   */
  getProcess(agentId: string): IPty | undefined {
    return this.processes.get(agentId)
  }

  /**
   * List all currently running agent IDs.
   */
  listRunning(): string[] {
    return Array.from(this.processes.keys())
  }

  /**
   * Write data to an agent's terminal.
   */
  write(agentId: string, data: string): void {
    const proc = this.processes.get(agentId)
    if (proc) {
      proc.write(data)
    }
  }

  /**
   * Resize an agent's terminal.
   */
  resize(agentId: string, cols: number, rows: number): void {
    const proc = this.processes.get(agentId)
    if (proc) {
      proc.resize(cols, rows)
    }
  }

  /**
   * Resolve CLI config for a given agent type from settings.
   */
  private resolveCliConfig(cliType: string): AgentCliConfig | null {
    // TODO: Read from DB settings once settings are persisted
    const config = DEFAULT_SETTINGS.agentClis.find((c) => c.cliType === cliType)
    return config ?? null
  }
}
