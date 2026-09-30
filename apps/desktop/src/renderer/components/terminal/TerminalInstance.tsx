import { cn } from "@exegol/ui";
import { type ForwardedRef, forwardRef } from "react";
import { useWorkspaceStore } from "../../stores/workspace";
import type { TerminalInstanceHandle, TerminalInstanceProps } from "./terminal-types";
import { useTerminalFileDrop } from "./use-terminal-file-drop";
import { useTerminalHandle } from "./use-terminal-handle";
import { useXterm } from "./use-xterm";

export type { TerminalInstanceHandle, TerminalInstanceProps } from "./terminal-types";

function paneIdForAgentSelector(
  state: ReturnType<typeof useWorkspaceStore.getState>,
  agentId: string,
  fallback: string | undefined,
): string | undefined {
  if (fallback) return fallback;
  for (const pw of Object.values(state.projectWorkspaces)) {
    for (const [id, pane] of Object.entries(pw.panes)) {
      if (pane.agentId === agentId) return id;
    }
  }
  return undefined;
}

export const TerminalInstance = forwardRef(function TerminalInstance(
  {
    agentId,
    cliType,
    readOnly = false,
    liveFeed = false,
    mirror = false,
    cardFont,
    initialContent,
    onReady,
    onScrollPosition,
    onOpenFileLink,
    onOpenUrlInPane,
    onSelectionChange,
    paneId: paneIdProp,
  }: TerminalInstanceProps,
  ref: ForwardedRef<TerminalInstanceHandle>,
) {
  // paneIdProp lets parents (e.g. floating windows) override the lookup.
  // The normal flow falls back to a workspace-store search by agentId so
  // we don't force TerminalPanel (owned by WT4) to plumb the paneId.
  // A mirror must not write cwd/exit state into the owning pane
  const paneId = useWorkspaceStore((s) =>
    mirror ? undefined : paneIdForAgentSelector(s, agentId, paneIdProp),
  );
  const { containerRef, terminalRef, fitAddonRef, serializeAddonRef } = useXterm({
    agentId,
    paneId,
    cliType,
    readOnly,
    liveFeed,
    mirror,
    cardFont,
    initialContent,
    onReady,
    onScrollPosition,
    onOpenFileLink,
    onOpenUrlInPane,
    onSelectionChange,
  });
  useTerminalHandle(ref, terminalRef, fitAddonRef, serializeAddonRef);
  const { isDragOver, handleDragOver, handleDragLeave, handleDrop } = useTerminalFileDrop(
    readOnly,
    terminalRef,
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target for file @mentions — xterm owns keyboard interaction
    <div
      ref={containerRef}
      className={cn(
        // Clipped, so a grid momentarily larger than its box can never push the
        // box (and with it the next fit); a mirror's box is its card's body
        "terminal-container h-full w-full overflow-hidden bg-bg-primary",
        isDragOver && "ring-2 ring-inset ring-accent/60",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    />
  );
});
