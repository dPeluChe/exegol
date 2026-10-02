import { LIVE_STATUSES } from "@exegol/shared";
import type { AgentState } from "../stores/agents";
import { useCloseConfirmStore } from "../stores/close-confirm";
import type { Pane } from "../stores/workspace";

export interface CloseSummary {
  title: string;
  lines: string[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const baseName = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** A terminal's name: its alias, the folder or task it was opened with, or its CLI */
function sessionName(agent: AgentState): string {
  if (agent.alias) return agent.alias;
  if (agent.taskDescription && agent.taskDescription !== agent.cliType) {
    return agent.taskDescription.slice(0, 40);
  }
  return agent.cliType === "shell" ? "Terminal" : agent.cliType;
}

/** One pane: what it is (`name`, the title for a single pane) and what closing it does */
function describePane(
  pane: Pane,
  agents: Record<string, AgentState>,
  unsaved: boolean,
): { name: string; effect: string; resumable?: boolean } | null {
  if (pane.type === "terminal") {
    const agent = pane.agentId ? agents[pane.agentId] : undefined;
    if (!agent || !LIVE_STATUSES.has(agent.status)) {
      return { name: agent ? sessionName(agent) : "Terminal", effect: "already ended" };
    }
    const name = sessionName(agent);
    if (agent.cliType !== "shell") {
      const cli = agent.alias ? ` (${agent.cliType})` : "";
      return { name: `${name}${cli}`, effect: "stops this session", resumable: true };
    }
    return {
      name: name === "Terminal" ? "Terminal" : `Terminal ${name}`,
      effect: agent.currentStep
        ? `ends it and stops ${agent.currentStep}`
        : "ends it (at its prompt)",
    };
  }
  if (pane.type === "browser") {
    const host = hostOf(pane.url);
    return { name: host ? `Browser ${host}` : "Browser", effect: "closes the page" };
  }
  if (pane.type === "files") {
    const file = pane.openFile ? ` ${baseName(pane.openFile)}` : "";
    return {
      name: `Files${file}`,
      effect: unsaved ? "unsaved changes are lost" : "closes the viewer",
    };
  }
  if (pane.type === "git") return { name: "Git", effect: "closes the changes view" };
  return null;
}

/** What closing these panes would end or lose, pane by pane, or null when nothing (empty panes
 *  only). `unsaved`: panes holding a file edit that is not saved */
export function describeClose(
  panes: Pane[],
  agents: Record<string, AgentState>,
  unsaved: ReadonlySet<string>,
): CloseSummary | null {
  const described = panes.flatMap((p) => describePane(p, agents, unsaved.has(p.id)) ?? []);
  const [only] = described;
  if (!only) return null;
  const lines = described.map((d) => `${d.name}: ${d.effect}.`);
  const resumable = described.filter((d) => d.resumable).length;
  if (resumable > 0) {
    lines.push(
      resumable === 1
        ? "Its session can be resumed from History."
        : "Their sessions can be resumed from History.",
    );
  }
  const title =
    described.length === 1 ? `Close ${only.name}?` : `Close ${plural(described.length, "pane")}?`;
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
