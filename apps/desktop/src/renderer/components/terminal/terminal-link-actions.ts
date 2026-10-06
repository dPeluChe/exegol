import { isHttpUrl } from "../../lib/browser-viewports";
import { openInBrowser } from "../../lib/open-in-browser";
import { trpcMutate } from "../../lib/trpc-client";
import { focusPane, useAgentStore } from "../../stores/agents";
import { peekTerminalFile } from "../../stores/terminal-links";
import { toastError } from "../../stores/toasts";
import { collectPaneIds, useWorkspaceStore } from "../../stores/workspace";
import { type LinkClick, type LinkMatch, linkAction } from "./terminal-links";

/** The session a link was clicked in: a pane, a stopped session or a Dashboard mirror */
export interface LinkSource {
  agentId: string;
}

/** A PiP window has no workspace to open a pane or a peek in */
const inFloatingWindow = () => new URLSearchParams(window.location.search).has("floatingPane");

/** Where the session shows in the workspace, any project */
function locateAgentPane(agentId: string) {
  const { projectWorkspaces } = useWorkspaceStore.getState();
  for (const [projectId, pw] of Object.entries(projectWorkspaces)) {
    for (const tab of pw.tabs) {
      const paneId = collectPaneIds(tab.layout).find((id) => pw.panes[id]?.agentId === agentId);
      if (paneId) return { projectId, tabId: tab.id, paneId };
    }
  }
  return null;
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
function workspaceTarget(source: LinkSource) {
  if (inFloatingWindow()) return null;
  const where = locateAgentPane(source.agentId);
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
  ws.setPaneUrl(preview, url);
  ws.setFocusedPane(preview);
  window.dispatchEvent(
    new CustomEvent("exegol:navigate-pane", { detail: { paneId: preview, url } }),
  );
}

export function openTerminalUrl(source: LinkSource, url: string, click: LinkClick): void {
  if (!isHttpUrl(url)) return;
  const target = linkAction("url", click) === "pane" ? workspaceTarget(source) : null;
  if (!target) {
    openInBrowser(url);
    return;
  }
  showInPreviewPane(target.tabId, target.paneId, target.projectId, url);
}

export function openTerminalFile(source: LinkSource, match: LinkMatch, click: LinkClick): void {
  const cwd = sessionCwd(source.agentId);
  const action = linkAction("file", click, match.text);
  const target = action === "peek" ? workspaceTarget(source) : null;
  if (target) {
    peekTerminalFile(source.agentId, { text: match.text, cwd, line: match.line });
    return;
  }
  trpcMutate("terminalLinks.open", {
    agentId: source.agentId,
    cwd,
    text: match.text,
    how: action === "reveal" || action === "ide" ? action : "external",
    line: match.line,
  }).catch(toastError("Could not open the file"));
}
