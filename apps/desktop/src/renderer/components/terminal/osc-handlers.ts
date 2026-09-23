import type { IMarker, Terminal } from "@xterm/xterm";

/**
 * Cross-handler state shared between OSC 7 (cwd) and OSC 133 (prompt markers).
 * Tracks whether a command is currently running so the cwd handler can reject
 * OSC 7 emitted by command output — e.g. an SSH session printing its remote
 * shell's OSC 7 through our PTY. Only OSC 7 issued between commands by our
 * local shell hook is trusted.
 */
export interface ShellIntegrationState {
  inCommand: boolean;
}

export function createShellIntegrationState(): ShellIntegrationState {
  return { inCommand: false };
}

export interface OscHandlerDeps {
  setCwd: (cwd: string) => void;
  setLastExit: (code: number | null) => void;
  /** Current theme colors, read at ANSWER time so a theme switch mid-session is
   *  reflected without re-registering handlers. */
  getColors?: () => TerminalColors;
}

export interface TerminalColors {
  foreground: string;
  background: string;
  cursor: string;
}

export interface OscHandlersDisposable {
  getPromptMarker: () => IMarker | null;
  dispose: () => void;
}

export function registerOscHandlers(
  term: Terminal,
  deps: OscHandlerDeps,
  state: ShellIntegrationState = createShellIntegrationState(),
): OscHandlersDisposable {
  let marker: IMarker | null = null;

  // OSC 10/11/12 — foreground / background / cursor queries. A TUI that asks
  // and gets no answer picks its own palette, which is why vim, delta and lazygit
  // render with colors that fight the app's theme inside our panes. Answering is
  // ~10 lines and makes them match.
  const colorQueries = COLOR_QUERY_CODES.map(({ code, pick }) =>
    term.parser.registerOscHandler(code, (data) => {
      // Only a QUERY is answered. `OSC 11 ; rgb:...` is an app SETTING the color,
      // and echoing a reply to that would be a report nobody asked for.
      if (data.trim() !== "?" || !deps.getColors) return false;
      term.input(`\u001b]${code};${toXParseColor(pick(deps.getColors()))}\u001b\\`, false);
      return true;
    }),
  );

  const osc7 = term.parser.registerOscHandler(7, (data) => {
    // SSH spoofing guard: only honor OSC 7 emitted between commands. Output
    // produced *while* a command runs is untrusted (remote shells, `cat` of
    // attacker bytes, etc.). Mirrors Terax osc-handlers.ts:27-32.
    if (state.inCommand) return true;
    const cwd = parseOsc7(data);
    if (cwd) deps.setCwd(cwd);
    return true;
  });

  const osc133 = term.parser.registerOscHandler(133, (data) => {
    if (data.startsWith("A")) {
      // Do NOT flip inCommand on A. A nested shell (a remote SSH session
      // with its own integration) emits 133;A inside our local command and
      // would otherwise clear the spoof guard before sending a malicious
      // OSC 7. Only 133;D — issued by our local shell's precmd, after the
      // remote subprocess exits — returns us to the trusted prompt state.
      marker?.dispose();
      marker = term.registerMarker(0);
    } else if (data.startsWith("B")) {
      state.inCommand = true;
    } else if (data.startsWith("C")) {
      state.inCommand = true;
    } else if (data.startsWith("D")) {
      state.inCommand = false;
      const code = parseOsc133D(data);
      // Bare `D` (no `;<n>` payload) is spec-legal but tells us nothing —
      // don't clobber a previously-stored exit code with null.
      if (code !== null) deps.setLastExit(code);
    }
    return true;
  });

  return {
    getPromptMarker: () => (marker && !marker.isDisposed ? marker : null),
    dispose: () => {
      for (const q of colorQueries) q.dispose();
      osc7.dispose();
      osc133.dispose();
      marker?.dispose();
      marker = null;
    },
  };
}

function parseOsc7(data: string): string | null {
  const m = data.match(/^file:\/\/[^/]*(\/.*)$/);
  if (!m) return null;
  let path = m[1];
  if (!path) return null;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed % escape — keep raw bytes rather than dropping the update.
  }
  // /C:/Users/foo → C:/Users/foo so it's a valid Windows path.
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path;
}

function parseOsc133D(data: string): number | null {
  // Format: "D" or "D;<exit-code>"
  const semi = data.indexOf(";");
  if (semi === -1) return null;
  const raw = data.slice(semi + 1).trim();
  if (raw === "") return null;
  const code = Number.parseInt(raw, 10);
  return Number.isFinite(code) ? code : null;
}

const COLOR_QUERY_CODES: Array<{ code: number; pick: (c: TerminalColors) => string }> = [
  { code: 10, pick: (c) => c.foreground },
  { code: 11, pick: (c) => c.background },
  { code: 12, pick: (c) => c.cursor },
];

/**
 * `#rrggbb` → `rgb:rrrr/gggg/bbbb`, the XParseColor form terminals reply in.
 * Each channel is doubled because the format is 16 bits per channel; sending
 * 8-bit values makes every color read as half as bright.
 */
export function toXParseColor(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return "rgb:0000/0000/0000";
  const [, r, g, b] = m as unknown as [string, string, string, string];
  return `rgb:${r}${r}/${g}${g}/${b}${b}`.toLowerCase();
}
