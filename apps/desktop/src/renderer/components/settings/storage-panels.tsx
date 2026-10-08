import type { BrowserPartitionUsage, StorageOtherEntry } from "@exegol/shared";
import { FolderOpen, LayoutDashboard, Trash2 } from "lucide-react";
import { useAllWorktrees } from "../../hooks/use-trpc";
import { useStorageAction, useWorktreeSizes } from "../../hooks/use-trpc-models";
import { SEMANTIC_BADGE } from "../../lib/semantic-colors";
import { summarizeOther } from "../../lib/storage-overview";
import { formatBytes } from "../workspace/sections/resource-format";
import { SMALL_BUTTON } from "./settings-ui";

export type Pending =
  | { kind: "clearScreenshots"; bytes: number }
  | { kind: "clearOldLogs" }
  | { kind: "clearBrowserCache"; projectId: string; projectName: string; bytes: number };

const LIST = "divide-y divide-border rounded-lg border border-border bg-bg-secondary";
const ROW = "flex items-center gap-3 px-3 py-1.5";
const BADGE = "rounded-full px-2 py-0.5 text-[10px]";
const OTHER_LIMIT = 12;
const ROOT_LABEL = { exegol: "~/.exegol", userData: "App data" } as const;

function Empty({ children }: { children: string }) {
  return <p className="text-xs text-text-muted">{children}</p>;
}

export function BrowserPanel({
  partitions,
  onPending,
}: {
  partitions: BrowserPartitionUsage[];
  onPending: (pending: Pending) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-muted">
        Each project's browser panes keep their own session. Clearing the cache drops cached pages
        and scripts only: cookies and site data stay, so logins stay.
      </p>
      {partitions.length === 0 ? (
        <Empty>No project has opened a browser pane yet.</Empty>
      ) : (
        <div className={LIST}>
          {partitions.map((p) => (
            <div key={p.projectId} className={ROW}>
              <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                {p.projectName}
              </span>
              <span className="text-[11px] tabular-nums text-text-muted">
                {formatBytes(p.bytes)} · cache {formatBytes(p.cacheBytes)}
              </span>
              <button
                type="button"
                className={SMALL_BUTTON}
                disabled={p.cacheBytes === 0}
                onClick={() =>
                  onPending({
                    kind: "clearBrowserCache",
                    projectId: p.projectId,
                    projectName: p.projectName,
                    bytes: p.cacheBytes,
                  })
                }
              >
                <Trash2 className="h-3 w-3" /> Clear cache
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WorktreesPanel() {
  const { data: worktrees, isLoading } = useAllWorktrees();
  const { data: sizes } = useWorktreeSizes();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[11px] text-text-muted">
          Checkouts agents worked in, under ~/.exegol/worktrees. Delete them from the Dashboard's
          Worktrees card, where an agent still using one is shown.
        </p>
        <button
          type="button"
          className={SMALL_BUTTON}
          onClick={() => window.api.settings.showDashboard()}
        >
          <LayoutDashboard className="h-3 w-3" /> Show in Dashboard
        </button>
      </div>
      {isLoading && <Empty>Loading worktrees...</Empty>}
      {worktrees?.length === 0 && <Empty>No Exegol worktrees.</Empty>}
      {worktrees && worktrees.length > 0 && (
        <div className={LIST}>
          {worktrees.map((wt) => (
            <div key={wt.id} className={ROW}>
              <span className="shrink-0 text-[11px] text-text-muted">{wt.projectName}</span>
              <code className="min-w-0 flex-1 truncate text-xs text-text-primary" title={wt.path}>
                {wt.branchName}
              </code>
              {!wt.exists ? (
                <span className={`${BADGE} ${SEMANTIC_BADGE.muted}`}>missing</span>
              ) : wt.dirty ? (
                <span className={`${BADGE} ${SEMANTIC_BADGE.warning}`} title="Uncommitted changes">
                  dirty
                </span>
              ) : (
                <span className={`${BADGE} ${SEMANTIC_BADGE.success}`}>clean</span>
              )}
              <span className="w-16 text-right text-[11px] tabular-nums text-text-muted">
                {sizes?.[wt.id] !== undefined ? formatBytes(sizes[wt.id] ?? 0) : "..."}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OtherPanel({ entries }: { entries: StorageOtherEntry[] }) {
  const action = useStorageAction();
  const { top, restCount, restBytes } = summarizeOther(entries, OTHER_LIMIT);
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-muted">
        Files and folders in ~/.exegol and Exegol's app data that no other category counts: hooks,
        caches Electron keeps, settings files.
      </p>
      {top.length === 0 ? (
        <Empty>Nothing else on disk.</Empty>
      ) : (
        <div className={LIST}>
          {top.map((e) => (
            <div key={`${e.root}/${e.name}`} className={ROW}>
              <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{e.name}</span>
              <span className="shrink-0 text-[10px] text-text-muted">{ROOT_LABEL[e.root]}</span>
              <span className="w-16 text-right text-[11px] tabular-nums text-text-secondary">
                {formatBytes(e.bytes)}
              </span>
              <button
                type="button"
                className={SMALL_BUTTON}
                onClick={() => action.mutate({ action: "openOther", root: e.root, name: e.name })}
              >
                <FolderOpen className="h-3 w-3" /> {e.isDir ? "Open" : "Show"}
              </button>
            </div>
          ))}
          {restCount > 0 && (
            <div className={`${ROW} text-[11px] text-text-muted`}>
              <span className="flex-1">
                {restCount} more {restCount === 1 ? "item" : "items"}
              </span>
              <span className="w-16 text-right tabular-nums">{formatBytes(restBytes)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
