import { LIVE_STATUSES } from "@exegol/shared";
import { nanoid } from "nanoid";
import type { AgentState } from "../stores/agents";
import { paneSlot } from "../stores/workspace/helpers";
import type {
  ClosedEntry,
  ClosedSession,
  CloseTarget,
  ProjectWorkspace,
} from "../stores/workspace/types";
import { sessionName } from "./agent-label";

/** What Reopen needs to put a closed tab or pane back; null when it held only launchers */
export function closedEntryFor(
  projectId: string,
  pw: ProjectWorkspace,
  target: CloseTarget,
  agents: Record<string, AgentState>,
  paneCwd: Record<string, string>,
  now = Date.now(),
): ClosedEntry | null {
  const tab = pw.tabs.find((t) => t.id === target.tabId);
  if (!tab) return null;
  const panes = target.paneIds.map((id) => pw.panes[id]).filter((p) => p !== undefined);
  if (!panes.some((p) => p.type !== "empty")) return null;
  const sessions: ClosedSession[] = [];
  for (const pane of panes) {
    const agent = pane.type === "terminal" && pane.agentId ? agents[pane.agentId] : undefined;
    if (!agent || !LIVE_STATUSES.has(agent.status)) continue;
    sessions.push({
      paneId: pane.id,
      agentId: agent.id,
      cliType: agent.cliType,
      name: agent.cliType === "shell" ? "Terminal" : sessionName(agent),
      taskDescription: agent.taskDescription,
      branchName: agent.branchName,
      accessMode: agent.accessMode,
      ...(paneCwd[pane.id] ? { cwd: paneCwd[pane.id] } : {}),
    });
  }
  const base = { id: nanoid(8), projectId, closedAt: now, panes, sessions };
  if (target.closesTab) {
    const index = pw.tabs.findIndex((t) => t.id === tab.id);
    return {
      ...base,
      kind: "tab",
      label: tab.label,
      tab: { id: tab.id, layout: tab.layout, index },
    };
  }
  const label = sessions[0]?.name ?? panes[0]?.type ?? "pane";
  return { ...base, kind: "pane", label, slot: paneSlot(tab, target.paneId) };
}

/** "Closed tab api (besalt, Terminal)" */
export function closedTitle(entry: ClosedEntry): string {
  const names = entry.sessions.map((s) => s.name);
  const what = entry.kind === "tab" ? `tab ${entry.label}` : "pane";
  return names.length > 0 ? `Closed ${what} (${names.join(", ")})` : `Closed ${what}`;
}

/** The sessions Reopen can only start fresh: their CLI cannot resume here */
export function freshOnly(entry: ClosedEntry, resumable: ReadonlySet<string>): ClosedSession[] {
  return entry.sessions.filter((s) => s.cliType !== "shell" && !resumable.has(s.cliType));
}
