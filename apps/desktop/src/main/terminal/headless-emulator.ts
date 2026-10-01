// Server-side headless terminal emulator (T36 + session reattach).
// Runs in main process via @xterm/headless — no DOM required.
// Tracks terminal state and modes for snapshot generation and session reattach.

import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/headless";

/** T143: cap the serialized ANSI snapshot size (reattach + disk scrollback flush). */
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024; // 2MB

/** Terminal mode state for reattach protocol */
interface TerminalModes {
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
  private _modes: TerminalModes = { ...DEFAULT_MODES };

  constructor(cols: number, rows: number, scrollback = 5000) {
    this.terminal = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);
  }

  /** Feed raw terminal data */
  write(data: string): void {
    this.parseDecModes(data);
    this.terminal.write(data);
  }

  /**
   * Serialized terminal state, replayable into a fresh xterm.
   *
   * When the session is on the ALTERNATE screen the alt buffer IS the content —
   * excluding it hands back the primary buffer, i.e. the shell prompt from
   * before the TUI launched, and the caller paints that over a live opencode.
   * That is the reattach bug of 2026-08-13 arriving through a second door, so
   * the switch is emitted here rather than left to each consumer.
   */
  snapshot(): string | null {
    try {
      const alt = this._modes.alternateScreen;
      const body = this.serializer.serialize({ excludeAltBuffer: !alt, excludeModes: true });
      const serialized = alt ? `\x1b[?1049h${body}` : body;
      const buf = Buffer.from(serialized, "utf-8");
      if (buf.byteLength <= MAX_SNAPSHOT_BYTES) return serialized;
      // Keep the most recent bytes — old scrollback is less useful than a
      // bounded reattach/disk-flush payload.
      return buf.subarray(buf.byteLength - MAX_SNAPSHOT_BYTES).toString("utf-8");
    } catch {
      return null;
    }
  }

  /**
   * The DEC modes the program turned on, as the sequences that turn them on again. The snapshot
   * leaves them out (a read-only scrollback view must not track the mouse); a LIVE view written
   * from it after a reset needs them back, or a TUI's mouse tracking (its wheel scroll), its
   * bracketed paste and its cursor keys stayed off until a resize made it redraw
   */
  modeSequence(): string {
    const m = this._modes;
    const on = (n: number) => `\x1b[?${n}h`;
    return [
      m.applicationCursorKeys && on(1),
      m.originMode && on(6),
      !m.autoWrap && "\x1b[?7l",
      !m.cursorVisible && "\x1b[?25l",
      m.mouseTrackingNormal && on(1000),
      m.mouseTrackingButtonEvent && on(1002),
      m.mouseTrackingAnyEvent && on(1003),
      m.mouseSgr && on(1006),
      m.focusReporting && on(1004),
      m.bracketedPaste && on(2004),
    ]
      .filter(Boolean)
      .join("");
  }

  get size(): { cols: number; rows: number } {
    return { cols: this.terminal.cols, rows: this.terminal.rows };
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  dispose(): void {
    this.terminal.dispose();
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
