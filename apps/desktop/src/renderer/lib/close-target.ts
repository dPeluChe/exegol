import type { Agent, AgentAccessMode } from "@exegol/shared";
import { deleteAgent } from "../hooks/use-delete-agent";
import { fetchResumableCliTypes, resumeSessionInto } from "../hooks/use-resume-agent";
import { showProject, useAgentStore } from "../stores/agents";
import { useToastStore } from "../stores/toasts";
import {
  type ClosedEntry,
  type CloseTarget,
  getProjectState,
  useWorkspaceStore,
} from "../stores/workspace";
import { closeTargetValid, resolveCloseTarget } from "../stores/workspace/helpers";
import { confirmCloseTarget } from "./close-guard";
import { closedEntryFor, closedTitle, freshOnly } from "./closed-entry";
import { focusActivePane } from "./pane-focus";
import { spawnShellIntoPane } from "./spawn-shell";
import { trpcMutate } from "./trpc-client";

const REOPEN_TOAST_MS = 10_000;

/** Close this tab or pane after asking when that ends a session, a terminal or unsaved edits;
 *  what the dialog lists is what closes. Live sessions get a Reopen toast */
export async function closeWithConfirm(target: CloseTarget | null): Promise<void> {
  const projectId = useWorkspaceStore.getState()._activeProjectId;
  if (!target || !projectId) return;
  const asked = getProjectState();
  if (!(await confirmCloseTarget(asked, target, useAgentStore.getState().agents))) return;
  const ws = useWorkspaceStore.getState();
  const pw = getProjectState();
  // The workspace moved while the dialog asked: close nothing rather than something else
  if (ws._activeProjectId !== projectId || !closeTargetValid(pw, target)) return;

  const entry = closedEntryFor(projectId, pw, target, useAgentStore.getState().agents, ws.paneCwd);
  // Layout first: stopping a session first released its pane and could close its tab, which
  // moved the active tab before the close ran
  ws.closeTarget(target);
  for (const id of target.paneIds) {
    const agentId = pw.panes[id]?.type === "terminal" ? pw.panes[id]?.agentId : undefined;
    if (agentId) deleteAgent(agentId);
  }
  if (!entry) return;
  ws.rememberClosed(entry);
  if (entry.sessions.length > 0) void announceClosed(entry);
}

/** Cmd+W: the active tab's focused pane (the tab when it is its last) */
export function closeActivePane(): Promise<void> {
  const ws = useWorkspaceStore.getState();
  return closeWithConfirm(resolveCloseTarget(getProjectState(), ws.focusedPaneId));
}

async function announceClosed(entry: ClosedEntry): Promise<void> {
  const fresh = freshOnly(entry, await fetchResumableCliTypes());
  useToastStore.getState().addToast({
    type: "info",
    title: closedTitle(entry),
    body:
      fresh.length > 0
        ? `${fresh.map((s) => s.cliType).join(", ")} cannot resume: Reopen starts it fresh`
        : undefined,
    action: { label: "Reopen", run: () => void reopenClosed(entry.id) },
    durationMs: REOPEN_TOAST_MS,
  });
}

/** Cmd+Shift+T: put a closed tab or pane back (the newest of this project, else the newest) and
 *  resume its sessions in place; shells start again in their folder */
export async function reopenClosed(entryId?: string): Promise<void> {
  const ws = useWorkspaceStore.getState();
  const entry = entryId
    ? ws.recentlyClosed.find((e) => e.id === entryId)
    : (ws.recentlyClosed.find((e) => e.projectId === ws._activeProjectId) ?? ws.recentlyClosed[0]);
  if (!entry) return;
  showProject(entry.projectId);
  const placed = useWorkspaceStore.getState().restoreClosed(entry.id);
  if (!placed) return;
  focusActivePane(placed.paneId);
  if (entry.sessions.length === 0) return;

  const resumable = await fetchResumableCliTypes();
  const problems: string[] = [];
  for (const s of entry.sessions) {
    try {
      if (s.cliType === "shell") {
        await spawnShellIntoPane(entry.projectId, s.paneId, s.taskDescription, s.cwd).catch(() =>
          spawnShellIntoPane(entry.projectId, s.paneId, s.taskDescription),
        );
        continue;
      }
      const canResume = resumable.has(s.cliType);
      await resumeSessionInto(
        {
          id: s.agentId,
          projectId: entry.projectId,
          cliType: s.cliType as Agent["cliType"],
          taskDescription: s.taskDescription,
          branchName: s.branchName,
          accessMode: s.accessMode as AgentAccessMode | null,
        },
        canResume,
        (data) => trpcMutate<Agent>("agents.spawn", data),
        s.paneId,
      );
      if (!canResume) problems.push(`${s.name}: ${s.cliType} cannot resume, started fresh`);
    } catch {
      problems.push(`${s.name}: could not start`);
    }
  }
  if (problems.length > 0) {
    useToastStore.getState().addToast({
      type: "warning",
      title: "Reopened",
      body: problems.join("; "),
    });
  }
}
