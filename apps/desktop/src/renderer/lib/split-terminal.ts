import { nanoid } from "nanoid";
import { useAgentStore } from "../stores/agents";
import { toastError } from "../stores/toasts";
import {
  getActivePaneId,
  getProjectState,
  type Pane,
  type PaneType,
  useWorkspaceStore,
} from "../stores/workspace";
import { dispatchRefitTerminals } from "./dispatch-refit";
import { launcherRelFor } from "./launcher";
import { dropPaneFocus, focusNewPane } from "./pane-focus";
import { spawnShellIntoPane } from "./spawn-shell";
import { trpcInvoke } from "./trpc-client";

/** What a pane says about its folder: a shell's OSC 7 cwd, a session's worktree */
interface PaneFolderFacts {
  shellCwd?: string;
  sessionDir?: string | null;
}

export const parentDir = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

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

/** OSC 7 only counts for a shell (an agent CLI's output could print one); else where the CLI's
 *  hooks last said it works, its start folder or its worktree */
async function paneFolder(paneId: string): Promise<string | undefined> {
  const pane = getProjectState().panes[paneId];
  const agent = pane?.agentId ? useAgentStore.getState().agents[pane.agentId] : undefined;
  const shellish = agent && (agent.cliType === "shell" || agent.launchedInShell);
  const shellCwd = shellish ? useWorkspaceStore.getState().paneCwd[paneId] : undefined;
  const sessionDir =
    pane?.agentId && !shellCwd
      ? await trpcInvoke<string | null>("agents.sessionFolder", {
          agentId: pane.agentId,
          live: true,
        }).catch(() => null)
      : null;
  return terminalCwdFor(pane, { shellCwd, sessionDir });
}

/** A new launcher starts in the folder `sourcePaneId` works in, while that is inside the project
 *  (async: the pane shows the root for a moment, and a folder picked meanwhile wins) */
async function preselectLauncherFolder(paneId: string, sourcePaneId: string | null) {
  const projectId = useWorkspaceStore.getState()._activeProjectId;
  if (!sourcePaneId || !projectId) return;
  const [folder, project] = await Promise.all([
    paneFolder(sourcePaneId),
    trpcInvoke<{ path: string } | null>("projects.get", { id: projectId }),
  ]);
  const rel = launcherRelFor(folder, project?.path);
  const pane = getProjectState().panes[paneId];
  if (!rel || pane?.type !== "empty" || pane.launcherFolder !== undefined) return;
  useWorkspaceStore.getState().updatePane(paneId, { launcherFolder: rel });
}

const preselectFrom = (paneId: string, sourcePaneId: string | null) =>
  void preselectLauncherFolder(paneId, sourcePaneId).catch(() => undefined);

/** A shell in `paneId`, in `cwd`; the project root when main refuses that folder (a shell that
 *  cd'd out of the project) */
async function shellInPane(projectId: string, paneId: string, cwd: string | undefined) {
  focusNewPane(paneId);
  try {
    await spawnShellIntoPane(projectId, paneId, "Terminal", cwd).catch((err) => {
      if (!cwd) throw err;
      return spawnShellIntoPane(projectId, paneId, "Terminal");
    });
  } catch (err) {
    dropPaneFocus(paneId);
    throw err;
  }
}

/** Split `paneId` and move the keyboard to the new pane, so its launcher keys work at once */
export function splitAndFocus(
  tabId: string,
  paneId: string | null,
  direction: "horizontal" | "vertical",
  type: PaneType = "empty",
): void {
  const id = nanoid(8);
  const source = paneId ?? getActivePaneId();
  useWorkspaceStore.getState().splitPane(tabId, paneId, direction, type, { id });
  dispatchRefitTerminals();
  focusNewPane(id);
  if (type === "empty") preselectFrom(id, source);
}

/** A new tab whose empty launcher takes the keyboard (Cmd+T, the tab bar +, the palette) */
export function addTabAndFocus(label?: string): string {
  const store = useWorkspaceStore.getState();
  const source = getActivePaneId();
  const tabId = store.addTab(label);
  const layout = getProjectState().tabs.find((t) => t.id === tabId)?.layout;
  if (layout?.type === "pane") {
    focusNewPane(layout.paneId);
    preselectFrom(layout.paneId, source);
  }
  return tabId;
}

/** Cmd+D / Cmd+Shift+D: split the pane keyboard actions act on */
export function splitActivePane(direction: "horizontal" | "vertical"): void {
  const tabId = getProjectState().activeTabId;
  if (tabId) splitAndFocus(tabId, getActivePaneId(), direction);
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

/** Split `paneId` with a browser pane that takes the typing (its address bar) once mounted */
export function splitWithBrowser(
  tabId: string,
  paneId: string,
  direction: "horizontal" | "vertical",
  url?: string,
): void {
  const id = nanoid(8);
  focusNewPane(id);
  useWorkspaceStore.getState().splitPane(tabId, paneId, direction, "browser", { id, url });
}
