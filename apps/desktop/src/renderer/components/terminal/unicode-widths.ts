import { Unicode11Addon } from "@xterm/addon-unicode11";

interface UnicodeTerminal {
  loadAddon(addon: Unicode11Addon): void;
  unicode: { activeVersion: string };
}

/** xterm's default Unicode 6 table puts emoji such as ✅ 🚀 ⚡ in one cell; CLIs measure two
 *  (go-runewidth, wcwidth), so an inline TUI's cursor moves land off by one per emoji.
 *  main's HeadlessEmulator does the same, so snapshots match the view */
export function applyUnicode11Widths(terminal: UnicodeTerminal): void {
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = "11";
}
