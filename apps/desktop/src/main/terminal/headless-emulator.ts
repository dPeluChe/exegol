// Server-side headless terminal emulator (T36).
// Runs in main process via @xterm/headless — no DOM required.
// Tracks terminal state for snapshot generation and CWD tracking.

import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/headless";

export class HeadlessEmulator {
  private terminal: Terminal;
  private serializer: SerializeAddon;
  private _cwd: string | null = null;

  constructor(cols: number, rows: number, scrollback = 5000) {
    this.terminal = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);
  }

  /** Feed raw terminal data */
  write(data: string): void {
    this.parseOsc7(data);
    this.terminal.write(data);
  }

  /** Generate a serialized snapshot of the full terminal state */
  snapshot(): string | null {
    try {
      return this.serializer.serialize({ excludeAltBuffer: true, excludeModes: true });
    } catch {
      return null;
    }
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  get cwd(): string | null {
    return this._cwd;
  }

  dispose(): void {
    this.terminal.dispose();
  }

  /** Parse OSC-7 escape sequences for CWD tracking */
  private parseOsc7(data: string): void {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence matching (ESC, BEL)
    const match = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)/);
    if (match?.[1]) {
      try {
        this._cwd = decodeURIComponent(match[1]);
      } catch {
        /* invalid encoding */
      }
    }
  }
}
