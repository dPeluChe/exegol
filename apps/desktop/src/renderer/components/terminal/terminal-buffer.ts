import type { Terminal } from "@xterm/xterm";

export function getScrollPosition(terminal: Terminal): { atTop: boolean; atBottom: boolean } {
  const buf = terminal.buffer.active;
  return {
    atTop: buf.viewportY === 0,
    atBottom: buf.viewportY >= buf.baseY,
  };
}
