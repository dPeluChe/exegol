// Staggered auto-resume after a lost sidecar: 36 CLIs relaunched at once took process memory
// from 11.2 to 15 GB, so they come back 3 at a time, what is on screen first.
import type { McpAgentState } from "@exegol/shared";
import { collectPaneIds } from "../stores/workspace";
import type { ProjectWorkspace } from "../stores/workspace/types";

export const AUTO_RESUME_CONCURRENCY = 3;
/** The next resume starts once the previous CLI is up, or after this */
export const AUTO_RESUME_SETTLE_MS = 10_000;
/** A CLI at its prompt is still starting its MCP servers: it must stay up this long */
export const AUTO_RESUME_QUIET_MS = 2_000;
/** A shell holds its slot this long: 16 at once timed out on their ready marker */
export const SHELL_SETTLE_MS = 1_000;

/** Pure: at its prompt (or gone) and its Exegol bridge connected, when one was wired */
export function sessionUp(status: string | undefined, mcp: McpAgentState | undefined): boolean {
  const atPrompt = status === undefined || status === "waiting_input" || status === "idle";
  return atPrompt && mcp !== "not_connected";
}

/** Resolves once `isUp` has held for `quietMs`, or after `maxMs`; `subscribe` reports changes */
export function waitUntilUp(
  isUp: () => boolean,
  subscribe: (onChange: () => void) => () => void,
  quietMs: number,
  maxMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | null = null;
    const done = () => {
      clearTimeout(cap);
      if (quiet) clearTimeout(quiet);
      unsub();
      resolve();
    };
    const check = () => {
      if (!isUp()) {
        if (quiet) clearTimeout(quiet);
        quiet = null;
      } else if (!quiet) quiet = setTimeout(done, quietMs);
    };
    const cap = setTimeout(done, maxMs);
    const unsub = subscribe(check);
    check();
  });
}

/** Pure: -1 pinned in Watching, 0 in the active project's active tab, 1 in another project's
 *  active tab, 2 in any other pane, 3 without a pane */
export function screenRank(
  agentId: string,
  projectId: string,
  workspaces: Record<string, ProjectWorkspace>,
  activeProjectId: string | null,
  pinned: ReadonlySet<string> = new Set(),
): number {
  if (pinned.has(agentId)) return -1;
  const pw = workspaces[projectId];
  if (!pw) return 3;
  const holds = (tabId: string | null) => {
    const tab = pw.tabs.find((t) => t.id === tabId);
    return !!tab && collectPaneIds(tab.layout).some((id) => pw.panes[id]?.agentId === agentId);
  };
  if (holds(pw.activeTabId)) return projectId === activeProjectId ? 0 : 1;
  return pw.tabs.some((t) => holds(t.id)) ? 2 : 3;
}

/** Pure: on screen first, then the most recently active */
export function orderAutoResume<T extends { lastActiveAt: number }>(
  items: T[],
  rankOf: (item: T) => number,
): T[] {
  const ranked = items.map((item) => ({ item, rank: rankOf(item) }));
  ranked.sort((a, b) => a.rank - b.rank || b.item.lastActiveAt - a.item.lastActiveAt);
  return ranked.map((r) => r.item);
}

/** Runs `run` over `items` in order, at most `limit` at once */
export async function staggered<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await run(item).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
