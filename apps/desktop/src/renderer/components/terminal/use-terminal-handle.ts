import type { FitAddon } from "@xterm/addon-fit";
import type { SerializeAddon } from "@xterm/addon-serialize";
import type { Terminal } from "@xterm/xterm";
import { type ForwardedRef, type RefObject, useImperativeHandle } from "react";
import type { TerminalInstanceHandle } from "./terminal-types";

/** The imperative API parents use (serialize on stop, refit, scroll, selection) */
export function useTerminalHandle(
  ref: ForwardedRef<TerminalInstanceHandle>,
  terminalRef: RefObject<Terminal | null>,
  fitAddonRef: RefObject<FitAddon | null>,
  serializeAddonRef: RefObject<SerializeAddon | null>,
) {
  useImperativeHandle(ref, () => ({
    serialize: () => {
      const addon = serializeAddonRef.current;
      const terminal = terminalRef.current;
      if (!addon || !terminal) return null;
      try {
        return addon.serialize({ excludeAltBuffer: true, excludeModes: true });
      } catch {
        return null;
      }
    },
    refit: () => {
      const fit = fitAddonRef.current;
      const terminal = terminalRef.current;
      if (!fit || !terminal) return;
      try {
        fit.fit();
        terminal.refresh(0, terminal.rows - 1);
      } catch {
        /* container may not be ready */
      }
    },
    scrollToTop: () => terminalRef.current?.scrollToTop(),
    scrollToBottom: () => terminalRef.current?.scrollToBottom(),
    getSelection: () => terminalRef.current?.getSelection() ?? "",
    clear: () => terminalRef.current?.clear(),
  }));
}
