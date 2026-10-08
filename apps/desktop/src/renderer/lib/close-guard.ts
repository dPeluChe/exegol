import { LIVE_STATUSES } from "@exegol/shared";
import type { AgentState } from "../stores/agents";
import { useCloseConfirmStore } from "../stores/close-confirm";
import type { CloseTarget, Pane } from "../stores/workspace";
import type { ProjectWorkspace } from "../stores/workspace/types";
import { sessionName } from "./agent-label";
import { pageLabel } from "./browser-viewports";
import { appKeys } from "./keymap";

export interface CloseSummary {
  title: string;
  lines: string[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const baseName = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/** The session's name, "Terminal" for a shell with none of its own */
function terminalName(agent: AgentState): string {
  const name = sessionName(agent);
  return name === "shell" ? "Terminal" : name;
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
      return { name: agent ? terminalName(agent) : "Terminal", effect: "already ended" };
    }
    const name = terminalName(agent);
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
    const page = pageLabel(pane.url);
    return { name: page ? `Browser ${page}` : "Browser", effect: "closes the page" };
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

/** What a close takes: a whole tab (by its name) or one pane */
export type CloseScope = { kind: "tab"; label: string } | { kind: "pane" };

/** The line every close confirmation ends with */
export const reopenHint = () => `You can reopen it with ${appKeys("Cmd+Shift+T")}.`;

/** What closing these panes would end or lose, pane by pane, or null when nothing (empty panes
 *  only). `unsaved`: panes holding a file edit that is not saved */
export function describeClose(
  panes: Pane[],
  agents: Record<string, AgentState>,
  unsaved: ReadonlySet<string>,
  scope: CloseScope = { kind: "pane" },
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
  lines.push(reopenHint());
  const title =
    scope.kind === "tab"
      ? `Close tab ${scope.label}?`
      : described.length === 1
        ? `Close pane ${only.name}?`
        : `Close ${plural(described.length, "pane")}?`;
  return { title, lines };
}

/** The panes a close target takes and how the dialog names it: one source for asking and closing */
export function closeTargetPanes(
  pw: ProjectWorkspace,
  target: CloseTarget,
): { panes: Pane[]; scope: CloseScope } {
  const tab = pw.tabs.find((t) => t.id === target.tabId);
  const panes = target.paneIds.map((id) => pw.panes[id]).filter((p) => p !== undefined);
  const scope: CloseScope =
    target.closesTab && tab ? { kind: "tab", label: tab.label } : { kind: "pane" };
  return { panes, scope };
}

/** Ask before closing this tab or pane; resolves true when there is nothing to lose */
export function confirmCloseTarget(
  pw: ProjectWorkspace,
  target: CloseTarget,
  agents: Record<string, AgentState>,
): Promise<boolean> {
  const { panes, scope } = closeTargetPanes(pw, target);
  const summary = describeClose(panes, agents, panesWithUnsavedEdits(target.paneIds), scope);
  if (!summary) return Promise.resolve(true);
  return useCloseConfirmStore.getState().ask(summary);
}

/** Panes whose Files viewer holds an unsaved edit (FileExplorer marks its root) */
export function panesWithUnsavedEdits(paneIds: string[]): Set<string> {
  return new Set(
    paneIds.filter((id) =>
      document.querySelector(`[data-pane-id="${CSS.escape(id)}"] [data-unsaved="true"]`),
    ),
  );
}
