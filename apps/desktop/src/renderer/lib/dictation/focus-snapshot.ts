import { findAgentPane, useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { getActivePaneId, useWorkspaceStore } from "../../stores/workspace";
import { focusedField } from "../focused-field";
import type { Run } from "./dictation-run";
import {
  confirmTarget,
  type DictationTarget,
  type FocusSnapshot,
  resolveTarget,
  takesDictation,
} from "./target";

/** Dashboard: the session whose mirror has the focus, Watching's or Company's, and its pane */
function focusedMirror(): FocusSnapshot["mirror"] {
  const agentId =
    document.activeElement?.closest<HTMLElement>("[data-mirror-agent-id]")?.dataset.mirrorAgentId;
  const agent = agentId ? useAgentStore.getState().agents[agentId] : undefined;
  if (!agentId || !agent) return undefined;
  return {
    agentId,
    projectId: agent.projectId,
    paneId: findAgentPane(agentId, agent.projectId)?.paneId ?? null,
    live: takesDictation(agent),
  };
}

export function snapshot(): {
  target: DictationTarget;
  field: HTMLElement | null;
  anchor: string | null;
} {
  const projectId = useAppStore.getState().activeProjectId;
  const { focusedPaneId, projectWorkspaces } = useWorkspaceStore.getState();
  // Only a pane of the tab on screen: resolveTarget sends anything else to the clipboard
  const activePane = getActivePaneId();
  const pane =
    projectId && activePane ? projectWorkspaces[projectId]?.panes[activePane] : undefined;
  const agent = pane?.agentId ? useAgentStore.getState().agents[pane.agentId] : undefined;
  const field = focusedField();
  const snap: FocusSnapshot = {
    activeView: useAppStore.getState().activeView,
    projectId,
    focusedPaneId,
    pane,
    sessionLive: !!agent && takesDictation(agent),
    editableField: !!field,
    mirror: focusedMirror(),
  };
  const target = resolveTarget(snap);
  // A field inside a pane (the browser's address bar): the overlay still centers on the pane
  const fieldPane = field?.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId ?? null;
  const anchor = "paneId" in target && snap.activeView === "workspace" ? target.paneId : fieldPane;
  return { target, field, anchor };
}

/** The start target if the focus never left it and it can still take text */
export function finalTarget(r: Run): DictationTarget {
  const target = confirmTarget(r.target, snapshot().target);
  if (target.kind === "field" && (!r.field?.isConnected || document.activeElement !== r.field)) {
    return { kind: "clipboard", projectId: target.projectId, why: "The field lost the focus" };
  }
  return target;
}
