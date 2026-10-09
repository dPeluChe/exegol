import { nanoid } from "nanoid";
import { useAgentStore } from "../stores/agents";
import { toastError } from "../stores/toasts";
import {
  getActivePaneId,
  getProjectState,
  type Pane,
  useWorkspaceStore,
} from "../stores/workspace";
import { dispatchRefitTerminals } from "./dispatch-refit";
import { focusActivePane } from "./pane-focus";
import { spawnShellIntoPane } from "./spawn-shell";
import { trpcInvoke } from "./trpc-client";

/** What a pane says about its folder: a shell's OSC 7 cwd, a session's worktree */
interface PaneFolderFacts {
  shellCwd?: string;
  sessionDir?: string | null;
}

const parentDir = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

/** The folder a terminal opened from `pane` starts in; undefined is the project root */
export function terminalCwdFor(
  pane: Pick<Pane, "type" | "filePath" | "openFile"> | undefined,
  facts: PaneFolderFacts = {},
): string | undefined {
  if (pane?.type === "terminal") return facts.shellCwd ?? facts.sessionDir ?? undefined;
  if (pane?.type === "files") return pane.openFile ? parentDir(pane.openFile) : pane.filePath;
  if (pane?.type === "git") return pane.filePath;
  return undefined;
}

/** OSC 7 only counts for a shell (an agent CLI's output could print one); else the worktree */
async function paneFolder(paneId: string): Promise<string | undefined> {
  const pane = getProjectState().panes[paneId];
  const agent = pane?.agentId ? useAgentStore.getState().agents[pane.agentId] : undefined;
  const shellish = agent && (agent.cliType === "shell" || agent.launchedInShell);
  const shellCwd = shellish ? useWorkspaceStore.getState().paneCwd[paneId] : undefined;
  const sessionDir =
    pane?.agentId && !shellCwd
      ? await trpcInvoke<string | null>("agents.getWorktreePath", { agentId: pane.agentId }).catch(
          () => null,
        )
      : null;
  return terminalCwdFor(pane, { shellCwd, sessionDir });
}

/** T in an empty pane's launcher, with no field taking the typing */
export function isQuickTerminalKey(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "repeat">,
  typing: boolean,
): boolean {
  return (
    !typing && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "t"
  );
}

/** A shell in `paneId`, in `cwd`; the project root when main refuses that folder (a shell that
 *  cd'd out of the project) */
async function shellInPane(projectId: string, paneId: string, cwd: string | undefined) {
  try {
    await spawnShellIntoPane(projectId, paneId, "Terminal", cwd);
  } catch (err) {
    if (!cwd) throw err;
    await spawnShellIntoPane(projectId, paneId, "Terminal");
  }
}

/** Split `paneId` and open a shell beside it, in the folder that pane works in */
export async function splitWithTerminal(
  tabId: string,
  paneId: string,
  direction: "horizontal" | "vertical" = "horizontal",
): Promise<void> {
  const projectId = useWorkspaceStore.getState()._activeProjectId;
  if (!projectId) return;
  const cwd = await paneFolder(paneId);
  const id = nanoid(8);
  useWorkspaceStore.getState().splitPane(tabId, paneId, direction, "empty", { id });
  dispatchRefitTerminals();
  focusActivePane(id);
  await shellInPane(projectId, id, cwd).catch(toastError("Could not open a terminal"));
}

/** The active pane when it is an empty launcher */
export function activeEmptyPaneId(): string | null {
  const paneId = getActivePaneId();
  return paneId && getProjectState().panes[paneId]?.type === "empty" ? paneId : null;
}

/** A shell in the active empty pane, at the project root */
export async function openTerminalHere(): Promise<void> {
  const paneId = activeEmptyPaneId();
  const projectId = useWorkspaceStore.getState()._activeProjectId;
  if (!paneId || !projectId) return;
  focusActivePane(paneId);
  await shellInPane(projectId, paneId, undefined).catch(toastError("Could not open a terminal"));
}

export async function splitActiveWithTerminal(): Promise<void> {
  const tabId = getProjectState().activeTabId;
  const paneId = getActivePaneId();
  if (tabId && paneId) await splitWithTerminal(tabId, paneId);
}

/** The chord: in the active pane when it is an empty launcher, else beside it */
export function terminalForActivePane(): Promise<void> {
  return activeEmptyPaneId() ? openTerminalHere() : splitActiveWithTerminal();
}
