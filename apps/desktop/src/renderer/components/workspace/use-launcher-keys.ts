import type { RefObject } from "react";
import { useLatest } from "../../hooks/use-latest";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { focusedField } from "../../lib/focused-field";
import {
  type LauncherAction,
  type LauncherKey,
  launcherFocusAllowed,
  launcherKeyAction,
} from "../../lib/launcher";
import { claimPaneFocus, paneRoot } from "../../lib/pane-focus";
import { useAppStore } from "../../stores/app";
import { getActivePaneId } from "../../stores/workspace";

interface KeyState {
  /** Off while the launch form or a modal holds the pane */
  enabled: boolean;
  actions: LauncherAction[];
  agentCount: number;
  commandCount: number;
  onKey: (hit: LauncherKey) => void;
}

/**
 * The launcher's keys (1-9, T F G B O E, Option+1..9, / and Cmd+F) for the pane they act on (getActivePaneId:
 * focusedPaneId is null or stale until a click), with no text field focused anywhere. Capture
 * phase and stopped, like the ended launcher's. The pane takes the keyboard when it mounts
 */
export function useLauncherKeys(
  paneId: string,
  rootRef: RefObject<HTMLDivElement | null>,
  state: KeyState,
) {
  const keys = useLatest(state);
  useMountEffect(() => {
    const focusRoot = () => rootRef.current?.focus();
    const isActive = () =>
      getActivePaneId() === paneId && useAppStore.getState().activeView === "workspace";
    // A new split, Cmd+] / Ctrl+Tab: the launcher takes the keyboard unless a field elsewhere has it
    if (claimPaneFocus(paneId)) focusRoot();
    else if (isActive() && !focusedField()) focusRoot();
    const onFocusPane = (e: Event) => {
      if ((e as CustomEvent<{ paneId: string }>).detail?.paneId === paneId) focusRoot();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const { enabled, actions, agentCount, commandCount, onKey } = keys.current;
      if (!enabled || !isActive() || document.querySelector('[role="dialog"]')) return;
      const allowed = launcherFocusAllowed(document.activeElement as HTMLElement | null, {
        body: document.body,
        launcher: rootRef.current,
        pane: paneRoot(paneId),
      });
      const hit = launcherKeyAction(e, !allowed, {
        actions,
        agents: agentCount,
        commands: commandCount,
      });
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      onKey(hit);
    };
    window.addEventListener("exegol:focus-pane", onFocusPane);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("exegol:focus-pane", onFocusPane);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  });
}
