import { nanoid } from "nanoid";
import { isHttpUrl } from "../../lib/browser-viewports";
import { dispatchRefitTerminals } from "../../lib/dispatch-refit";
import { closeRoute } from "../../lib/file-window";
import { openInBrowser } from "../../lib/open-in-browser";
import { runIdeResult } from "../../lib/open-in-ide";
import { focusActivePane, focusNewPane } from "../../lib/pane-focus";
import { trpcMutate } from "../../lib/trpc-client";
import { findAgentPane, focusPane, useAgentStore } from "../../stores/agents";
import {
  closeTerminalPeek,
  peekTerminalFile,
  type TerminalLinkPeek,
  useTerminalLinkStore,
} from "../../stores/terminal-links";
import { toastError } from "../../stores/toasts";
import {
  collectPaneIds,
  getActivePaneId,
  getProjectState,
  useWorkspaceStore,
} from "../../stores/workspace";
import { type LinkClick, type LinkMatch, linkAction } from "./terminal-links";

/** A PiP window has no workspace to open a pane or a peek in */
const inFloatingWindow = () => new URLSearchParams(window.location.search).has("floatingPane");

/** Where the session shows in its project's workspace */
function locateAgentPane(agentId: string) {
  const projectId = useAgentStore.getState().agents[agentId]?.projectId;
  const where = projectId ? findAgentPane(agentId, projectId) : null;
  return where && projectId ? { ...where, projectId } : null;
}

/** A shell's cwd once it moved (OSC 7); agents use their worktree or project, known to main */
export function sessionCwd(agentId: string): string | undefined {
  const agent = useAgentStore.getState().agents[agentId];
  if (agent && agent.cliType !== "shell" && !agent.launchedInShell) return undefined;
  const where = locateAgentPane(agentId);
  return where ? useWorkspaceStore.getState().paneCwd[where.paneId] : undefined;
}

/** The session's pane, brought on screen (a click on the Dashboard lands in its project); null
 *  when there is none to open beside */
function workspaceTarget(agentId: string) {
  if (inFloatingWindow()) return null;
  const where = locateAgentPane(agentId);
  if (where) focusPane(where.projectId, where.tabId, where.paneId);
  return where;
}

/** One link preview pane per tab: reused and navigated, else split beside the terminal */
function showInPreviewPane(tabId: string, paneId: string, projectId: string, url: string): void {
  const ws = useWorkspaceStore.getState();
  const pw = ws.projectWorkspaces[projectId];
  const tab = pw?.tabs.find((t) => t.id === tabId);
  if (!pw || !tab) return;
  const preview = collectPaneIds(tab.layout).find(
    (id) => pw.panes[id]?.type === "browser" && pw.panes[id]?.linkPreview,
  );
  if (!preview) {
    ws.splitPane(tabId, paneId, "horizontal", "browser", { url, linkPreview: true });
    return;
  }
  ws.setFocusedPane(preview);
  window.dispatchEvent(
    new CustomEvent("exegol:navigate-pane", { detail: { paneId: preview, url } }),
  );
}

/** A link clicked in a pane's own content (a Files preview): the tab's link preview pane */
export function openUrlBesideActivePane(url: string): void {
  const projectId = useWorkspaceStore.getState()._activeProjectId;
  const tabId = getProjectState().activeTabId;
  const paneId = getActivePaneId();
  if (!isHttpUrl(url)) return;
  if (!projectId || !tabId || !paneId || inFloatingWindow()) openInBrowser(url);
  else showInPreviewPane(tabId, paneId, projectId, url);
}

export function openTerminalUrl(agentId: string, url: string, click: LinkClick): void {
  if (!isHttpUrl(url)) return;
  const target = linkAction("url", click) === "pane" ? workspaceTarget(agentId) : null;
  if (!target) {
    openInBrowser(url);
    return;
  }
  showInPreviewPane(target.tabId, target.paneId, target.projectId, url);
}

export function openTerminalFile(agentId: string, match: LinkMatch, click: LinkClick): void {
  const cwd = sessionCwd(agentId);
  const action = linkAction("file", click, match.text);
  const target = action === "peek" ? workspaceTarget(agentId) : null;
  if (target) {
    peekTerminalFile({ agentId, text: match.text, cwd, line: match.line });
    return;
  }
  trpcMutate<{ terminalCommand?: string }>("terminalLinks.open", {
    agentId,
    cwd,
    text: match.text,
    how: action === "reveal" || action === "ide" ? action : "external",
    line: match.line,
  })
    .then((result) => runIdeResult(useAgentStore.getState().agents[agentId]?.projectId, result))
    .catch(toastError("Could not open the file"));
}

/** Closes the file window and gives the keyboard back to its session's terminal; false when none
 *  was open */
export function closeFileWindow(): boolean {
  const agentId = useTerminalLinkStore.getState().peek?.agentId;
  if (!closeTerminalPeek()) return false;
  const where = agentId ? locateAgentPane(agentId) : null;
  if (where && where.projectId === useWorkspaceStore.getState()._activeProjectId) {
    focusActivePane(where.paneId);
  }
  return true;
}

/** Cmd+W: the file window when one is open, else the pane (false) */
export function closeFileWindowFirst(): boolean {
  const open = !!useTerminalLinkStore.getState().peek;
  return closeRoute(open) === "file-window" && closeFileWindow();
}

const parentDir = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

/** The window's file as a real Files pane beside its terminal; the tree roots at the project, or
 *  at the file's folder for a worktree file */
export function openPeekInFilesPane(peek: TerminalLinkPeek, path: string, projectPath?: string) {
  const where = workspaceTarget(peek.agentId);
  if (!where) return;
  const ws = useWorkspaceStore.getState();
  const id = nanoid(8);
  ws.splitPane(where.tabId, where.paneId, "horizontal", "files", { id });
  const inProject = !!projectPath && path.startsWith(`${projectPath.replace(/\/$/, "")}/`);
  ws.updatePane(id, { filePath: inProject ? undefined : parentDir(path), openFile: path });
  closeTerminalPeek();
  dispatchRefitTerminals();
  focusNewPane(id);
}

export function openPeekInIde(peek: TerminalLinkPeek): void {
  const { agentId, cwd, text, line } = peek;
  trpcMutate<{ terminalCommand?: string }>("terminalLinks.open", {
    agentId,
    cwd,
    text,
    how: "ide",
    line,
  })
    .then((result) => runIdeResult(useAgentStore.getState().agents[agentId]?.projectId, result))
    .catch(toastError("Could not open the file"));
}

export function openPeekWith(peek: TerminalLinkPeek, how: "reveal" | "external"): void {
  const { agentId, cwd, text } = peek;
  trpcMutate("terminalLinks.open", { agentId, cwd, text, how }).catch(
    toastError("Could not open the file"),
  );
}
