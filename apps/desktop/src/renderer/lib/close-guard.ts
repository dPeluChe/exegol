import { LIVE_STATUSES } from "@exegol/shared";
import type { AgentState } from "../stores/agents";
import { useCloseConfirmStore } from "../stores/close-confirm";
import type { Pane } from "../stores/workspace";

export interface CloseSummary {
  title: string;
  lines: string[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What closing these panes would end or lose, or null when nothing (empty panes only).
 *  `unsaved`: panes holding a file edit that is not saved */
export function describeClose(
  panes: Pane[],
  agents: Record<string, AgentState>,
  unsaved: ReadonlySet<string>,
): CloseSummary | null {
  const lines: string[] = [];
  const liveAgents: string[] = [];
  let shells = 0;
  let browsers = 0;
  let files = 0;
  let other = 0;
  for (const pane of panes) {
    if (pane.type === "terminal") {
      const agent = pane.agentId ? agents[pane.agentId] : undefined;
      if (!agent || !LIVE_STATUSES.has(agent.status)) other++;
      else if (agent.cliType === "shell") shells++;
      else liveAgents.push(agent.alias || agent.cliType);
    } else if (pane.type === "browser") browsers++;
    else if (pane.type === "files") files++;
    else if (pane.type !== "empty") other++;
  }
  const unsavedCount = panes.filter((p) => unsaved.has(p.id)).length;
  if (liveAgents.length + shells + browsers + files + other === 0) return null;

  if (liveAgents.length > 0) {
    lines.push(
      `Stops ${liveAgents.join(", ")} (${liveAgents.length === 1 ? "its session can be resumed from History" : "their sessions can be resumed from History"}).`,
    );
  }
  if (shells > 0) lines.push(`Ends ${plural(shells, "terminal")} and whatever runs in it.`);
  if (unsavedCount > 0)
    lines.push(`Unsaved file changes in ${plural(unsavedCount, "pane")} are lost.`);
  if (browsers > 0 && lines.length === 0) lines.push(`Closes ${plural(browsers, "browser pane")}.`);
  if (lines.length === 0)
    lines.push(
      panes.length === 1 ? "Closes this pane." : `Closes ${plural(panes.length, "pane")}.`,
    );

  const title =
    panes.length === 1
      ? liveAgents.length === 1
        ? `Close ${liveAgents[0]}?`
        : "Close this pane?"
      : `Close ${plural(panes.length, "pane")}?`;
  return { title, lines };
}

/** Panes whose Files viewer holds an unsaved edit (FileExplorer marks its root) */
export function panesWithUnsavedEdits(paneIds: string[]): Set<string> {
  return new Set(
    paneIds.filter((id) =>
      document.querySelector(`[data-pane-id="${CSS.escape(id)}"] [data-unsaved="true"]`),
    ),
  );
}

/** Ask before closing these panes; resolves true when there is nothing to lose */
export function confirmClosePanes(
  panes: Pane[],
  agents: Record<string, AgentState>,
): Promise<boolean> {
  const summary = describeClose(panes, agents, panesWithUnsavedEdits(panes.map((p) => p.id)));
  if (!summary) return Promise.resolve(true);
  return useCloseConfirmStore.getState().ask(summary);
}
