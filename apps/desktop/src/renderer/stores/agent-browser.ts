import type { AgentBrowserPaneState } from "@exegol/shared";
import { nanoid } from "nanoid";
import { create } from "zustand";
import { useAgentStore } from "./agents";
import { useAppStore } from "./app";
import { useWorkspaceStore } from "./workspace";
import { collectPaneIds } from "./workspace/helpers";

interface AgentBrowserStore {
  /** Keyed by paneId: who drives each browser pane (main pushes every change) */
  panes: Record<string, AgentBrowserPaneState>;
}

export const useAgentBrowserStore = create<AgentBrowserStore>()(() => ({ panes: {} }));

export const useAgentBrowserPane = (paneId: string) => useAgentBrowserStore((s) => s.panes[paneId]);

/** What the attention item says: the agent's own reason, or the login it stopped at */
export function needsUserReason(s: AgentBrowserPaneState): string | null {
  if (s.waitingReason) return s.waitingReason;
  if (s.needsUserHost) return `log in at ${s.needsUserHost}`;
  return null;
}

/** An agent asking the user for the browser raises an alert that opens that pane; the hand-back
 *  clears it */
function syncAttention(prev: AgentBrowserPaneState | undefined, next: AgentBrowserPaneState) {
  const reason = needsUserReason(next);
  const store = useAgentStore.getState();
  if (reason && next.agentId && reason !== (prev ? needsUserReason(prev) : null)) {
    const alias = next.alias ?? "An agent";
    store.addAttentionItem(next.agentId, {
      level: "action_needed",
      reason: `${alias} needs you to ${reason}`,
      paneId: next.paneId,
    });
  } else if (!reason && prev && needsUserReason(prev) && prev.agentId) {
    if (store.attentionItems[prev.agentId]?.paneId === next.paneId) {
      store.dismissAttention(prev.agentId);
    }
  }
}

function apply(state: AgentBrowserPaneState, mainWindow: boolean): void {
  const prev = useAgentBrowserStore.getState().panes[state.paneId];
  useAgentBrowserStore.setState((s) => ({ panes: { ...s.panes, [state.paneId]: state } }));
  if (mainWindow) syncAttention(prev, state);
}

/** browser_open with no live pane: beside the agent when its project is on screen, else a
 *  floating window (only the shown project's panes are mounted, so only they can load a page) */
function openForAgent(req: { projectId: string; agentId: string; url: string }): string {
  const paneId = nanoid(8);
  const ws = useWorkspaceStore.getState();
  const pw = ws.projectWorkspaces[req.projectId];
  if (useAppStore.getState().activeProjectId === req.projectId && pw) {
    const agentTab = pw.tabs.find((t) =>
      collectPaneIds(t.layout).some((id) => pw.panes[id]?.agentId === req.agentId),
    );
    const tabId = agentTab?.id ?? pw.activeTabId ?? pw.tabs[0]?.id;
    if (tabId) {
      const beside = agentTab
        ? collectPaneIds(agentTab.layout).find((id) => pw.panes[id]?.agentId === req.agentId)
        : null;
      ws.splitPane(tabId, beside ?? null, "horizontal", "browser", { url: req.url, id: paneId });
      return paneId;
    }
  }
  void window.api.floating.open({
    paneId,
    type: "browser",
    title: "Agent browser",
    url: req.url,
    projectId: req.projectId,
  });
  return paneId;
}

let stop: (() => void) | null = null;

/** Once per window. The main window also raises alerts and opens panes for browser_open */
export function startAgentBrowserPush(mainWindow: boolean): () => void {
  if (stop) return stop;
  const offState = window.api.browser.onAgentState((s) => apply(s, mainWindow));
  const offOpen = mainWindow
    ? window.api.browser.onOpenRequest((req) => {
        try {
          void window.api.browser.openResult({
            requestId: req.requestId,
            paneId: openForAgent(req),
          });
        } catch (err) {
          void window.api.browser.openResult({ requestId: req.requestId, error: String(err) });
        }
      })
    : () => {};
  window.api.browser
    .agentStates()
    .then((list) => {
      for (const s of list) apply(s, false);
    })
    .catch(() => {});
  stop = () => {
    offState();
    offOpen();
    stop = null;
  };
  return stop;
}
