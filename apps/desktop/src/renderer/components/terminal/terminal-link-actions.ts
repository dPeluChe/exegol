import { isHttpUrl } from "../../lib/browser-viewports";
import { openInBrowser } from "../../lib/open-in-browser";
import { trpcMutate } from "../../lib/trpc-client";
import { findAgentPane, focusPane, useAgentStore } from "../../stores/agents";
import { peekTerminalFile } from "../../stores/terminal-links";
import { toastError } from "../../stores/toasts";
import { collectPaneIds, useWorkspaceStore } from "../../stores/workspace";
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
    peekTerminalFile(agentId, { text: match.text, cwd, line: match.line });
    return;
  }
  trpcMutate("terminalLinks.open", {
    agentId,
    cwd,
    text: match.text,
    how: action === "reveal" || action === "ide" ? action : "external",
    line: match.line,
  }).catch(toastError("Could not open the file"));
}
