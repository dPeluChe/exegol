// Phase 2: Standalone terminal support (non-agent interactive terminals).
// This module is not yet wired into the app but will be used when we add
// user-facing terminal tabs that are independent of AI agent sessions.

import { BrowserWindow } from "electron";
import type { IPty } from "node-pty";
import * as pty from "node-pty";

export type PtyOptions = {
  cwd?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
};

/**
 * Manages standalone PTY instances for interactive terminals
 * (separate from agent processes managed by AgentManager).
 */
export class PtyManager {
  private terminals: Map<string, IPty> = new Map();
  private dataListeners: Map<string, Set<(data: string) => void>> = new Map();

  /**
   * Create a new pseudo-terminal.
   */
  create(id: string, options: PtyOptions = {}): IPty {
    if (this.terminals.has(id)) {
      throw new Error(`Terminal with id "${id}" already exists`);
    }

    const shell = this.detectShell();
    const { cwd, cols = 80, rows = 24, env } = options;

    const proc = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: cwd ?? process.env.HOME ?? "/",
      env: {
        ...process.env,
        ...env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      } as Record<string, string>,
    });

    this.terminals.set(id, proc);
    this.dataListeners.set(id, new Set());

    // Forward output to registered listeners and renderer
    proc.onData((data: string) => {
      // Notify local listeners
      const listeners = this.dataListeners.get(id);
      if (listeners) {
        for (const cb of listeners) {
          cb(data);
        }
      }

      // Forward to renderer windows
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        win.webContents.send("terminal:data", id, data);
      }
    });

    // Clean up on exit
    proc.onExit(() => {
      this.terminals.delete(id);
      this.dataListeners.delete(id);
    });

    return proc;
  }

  /**
   * Write input data to a terminal.
   */
  write(id: string, data: string): void {
    const proc = this.terminals.get(id);
    if (!proc) {
      throw new Error(`Terminal "${id}" not found`);
    }
    proc.write(data);
  }

  /**
   * Resize a terminal.
   */
  resize(id: string, cols: number, rows: number): void {
    const proc = this.terminals.get(id);
    if (!proc) return;
    proc.resize(cols, rows);
  }

  /**
   * Destroy a terminal and clean up resources.
   */
  destroy(id: string): void {
    const proc = this.terminals.get(id);
    if (!proc) return;

    proc.kill();
    this.terminals.delete(id);
    this.dataListeners.delete(id);
  }

  /**
   * Register a callback for terminal output data.
   * Returns an unsubscribe function.
   */
  onData(id: string, callback: (data: string) => void): () => void {
    let listeners = this.dataListeners.get(id);
    if (!listeners) {
      listeners = new Set();
      this.dataListeners.set(id, listeners);
    }
    listeners.add(callback);

    return () => {
      listeners?.delete(callback);
    };
  }

  /**
   * Check if a terminal exists.
   */
  has(id: string): boolean {
    return this.terminals.has(id);
  }

  /**
   * Get all active terminal IDs.
   */
  listIds(): string[] {
    return Array.from(this.terminals.keys());
  }

  /**
   * Destroy all terminals.
   */
  destroyAll(): void {
    for (const id of this.terminals.keys()) {
      this.destroy(id);
    }
  }

  /**
   * Detect the appropriate shell for the current platform.
   */
  private detectShell(): string {
    if (process.platform === "win32") {
      return process.env.COMSPEC || "powershell.exe";
    }
    return process.env.SHELL || "/bin/zsh";
  }
}

// Singleton instance
let instance: PtyManager | null = null;

export function getPtyManager(): PtyManager {
  if (!instance) {
    instance = new PtyManager();
  }
  return instance;
}
