// Server-side headless terminal emulator (T36 + session reattach).
// Runs in main process via @xterm/headless — no DOM required.
// Tracks terminal state, modes, CWD for snapshot generation and session reattach.

import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/headless";

const ESC = "\x1b";

/** T143: cap the serialized ANSI snapshot size (reattach + disk scrollback flush). */
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024; // 2MB

/** Terminal mode state for reattach protocol */
export interface TerminalModes {
  applicationCursorKeys: boolean; // DECCKM (1)
  originMode: boolean; // DECOM (6)
  autoWrap: boolean; // DECAWM (7)
  cursorVisible: boolean; // DECTCEM (25)
  mouseTrackingNormal: boolean; // (1000)
  mouseTrackingButtonEvent: boolean; // (1002)
  mouseTrackingAnyEvent: boolean; // (1003)
  mouseSgr: boolean; // (1006)
  focusReporting: boolean; // (1004)
  bracketedPaste: boolean; // (2004)
  alternateScreen: boolean; // (1049)
}

/** Full snapshot for session reattach */
export interface SessionSnapshot {
  snapshotAnsi: string;
  rehydrateSequences: string;
  cwd: string | null;
  modes: TerminalModes;
  cols: number;
  rows: number;
}

const DEFAULT_MODES: TerminalModes = {
  applicationCursorKeys: false,
  originMode: false,
  autoWrap: true,
  cursorVisible: true,
  mouseTrackingNormal: false,
  mouseTrackingButtonEvent: false,
  mouseTrackingAnyEvent: false,
  mouseSgr: false,
  focusReporting: false,
  bracketedPaste: false,
  alternateScreen: false,
};

export class HeadlessEmulator {
  private terminal: Terminal;
  private serializer: SerializeAddon;
  private _cwd: string | null = null;
  private _modes: TerminalModes = { ...DEFAULT_MODES };

  constructor(cols: number, rows: number, scrollback = 5000) {
    this.terminal = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);
  }

  /** Feed raw terminal data */
  write(data: string): void {
    this.parseOsc7(data);
    this.parseDecModes(data);
    this.terminal.write(data);
  }

  /** Generate a serialized snapshot of the full terminal state */
  snapshot(): string | null {
    try {
      const serialized = this.serializer.serialize({ excludeAltBuffer: true, excludeModes: true });
      const buf = Buffer.from(serialized, "utf-8");
      if (buf.byteLength <= MAX_SNAPSHOT_BYTES) return serialized;
      // Keep the most recent bytes — old scrollback is less useful than a
      // bounded reattach/disk-flush payload.
      return buf.subarray(buf.byteLength - MAX_SNAPSHOT_BYTES).toString("utf-8");
    } catch {
      return null;
    }
  }

  /** Generate full session snapshot for reattach protocol */
  sessionSnapshot(): SessionSnapshot | null {
    const snapshotAnsi = this.snapshot();
    if (!snapshotAnsi) return null;
    return {
      snapshotAnsi,
      rehydrateSequences: this.generateRehydrateSequences(),
      cwd: this._cwd,
      modes: { ...this._modes },
      cols: this.terminal.cols,
      rows: this.terminal.rows,
    };
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  get cwd(): string | null {
    return this._cwd;
  }

  get modes(): TerminalModes {
    return { ...this._modes };
  }

  dispose(): void {
    this.terminal.dispose();
  }

  /** Generate escape sequences to restore current mode state on reattach */
  private generateRehydrateSequences(): string {
    const seqs: string[] = [];
    const m = this._modes;
    const add = (num: number, on: boolean, defaultOn: boolean) => {
      if (on !== defaultOn) seqs.push(`${ESC}[?${num}${on ? "h" : "l"}`);
    };
    add(1, m.applicationCursorKeys, false);
    add(6, m.originMode, false);
    add(7, m.autoWrap, true);
    add(25, m.cursorVisible, true);
    add(1000, m.mouseTrackingNormal, false);
    add(1002, m.mouseTrackingButtonEvent, false);
    add(1003, m.mouseTrackingAnyEvent, false);
    add(1006, m.mouseSgr, false);
    add(1004, m.focusReporting, false);
    add(2004, m.bracketedPaste, false);
    // Note: alternate screen (1049) not restored — snapshot contains correct buffer
    return seqs.join("");
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

  /** Track DECSET/DECRST mode changes from terminal output */
  private parseDecModes(data: string): void {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI DECSET/DECRST matching
    const regex = /\x1b\[\?(\d+)([hl])/g;
    for (let match = regex.exec(data); match !== null; match = regex.exec(data)) {
      const mode = Number.parseInt(match[1] ?? "0", 10);
      const enabled = match[2] === "h";
      switch (mode) {
        case 1:
          this._modes.applicationCursorKeys = enabled;
          break;
        case 6:
          this._modes.originMode = enabled;
          break;
        case 7:
          this._modes.autoWrap = enabled;
          break;
        case 25:
          this._modes.cursorVisible = enabled;
          break;
        case 1000:
          this._modes.mouseTrackingNormal = enabled;
          break;
        case 1002:
          this._modes.mouseTrackingButtonEvent = enabled;
          break;
        case 1003:
          this._modes.mouseTrackingAnyEvent = enabled;
          break;
        case 1006:
          this._modes.mouseSgr = enabled;
          break;
        case 1004:
          this._modes.focusReporting = enabled;
          break;
        case 2004:
          this._modes.bracketedPaste = enabled;
          break;
        case 1049:
        case 47:
          this._modes.alternateScreen = enabled;
          break;
      }
    }
  }
}
