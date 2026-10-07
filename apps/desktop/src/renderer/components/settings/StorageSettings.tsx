import type { StorageCategory, StorageRow } from "@exegol/shared";
import { FolderOpen, HardDrive, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  useModelAction,
  useModels,
  useRefreshStorage,
  useStorageAction,
  useStorageReport,
} from "../../hooks/use-trpc-models";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { formatBytes } from "../workspace/sections/resource-format";

type Pending =
  | { kind: "clearScreenshots"; bytes: number }
  | { kind: "clearOldLogs" }
  | { kind: "clearBrowserCache"; projectId: string; projectName: string; bytes: number }
  | { kind: "deleteModel"; id: string; name: string; bytes: number };

const BUTTON =
  "flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-white/5 disabled:opacity-50";

const HINTS: Partial<Record<StorageCategory, string>> = {
  worktrees: "Clean up worktrees from the Dashboard's Worktrees card: a worktree can hold work.",
  scrollback: "Saved terminal output of agents, kept for their history.",
  database: "Projects, agents, history and settings.",
};

export function StorageSettings() {
  const { data: report, isLoading } = useStorageReport();
  const refresh = useRefreshStorage();
  const action = useStorageAction();
  const { data: models } = useModels();
  const modelAction = useModelAction();
  const installed = models?.filter((m) => m.status.state === "ready") ?? [];
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = () => {
    if (!pending) return;
    if (pending.kind === "deleteModel") {
      modelAction.mutate({ action: "delete", id: pending.id });
    } else if (pending.kind === "clearBrowserCache") {
      action.mutate({ action: "clearBrowserCache", projectId: pending.projectId });
    } else {
      action.mutate({ action: pending.kind });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <HardDrive className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Storage</h3>
        <button
          type="button"
          className={`${BUTTON} ml-auto`}
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw className={`h-3 w-3 ${refresh.isPending ? "animate-spin" : ""}`} /> Recount
        </button>
      </div>
      {isLoading && <p className="text-xs text-text-muted">Measuring disk use...</p>}
      {report && (
        <>
          <p className="text-xs text-text-muted">
            Exegol uses <span className="text-text-primary">{formatBytes(report.totalBytes)}</span>
            {report.freeBytes !== null && (
              <>
                {" "}
                · <span className="text-text-primary">{formatBytes(report.freeBytes)}</span> free
                {report.diskBytes !== null && ` of ${formatBytes(report.diskBytes)}`}
              </>
            )}
          </p>
          <div className="divide-y divide-border rounded-lg border border-border bg-bg-secondary">
            {report.rows.map((row) => (
              <StorageRowView
                key={row.category}
                row={row}
                onOpen={() => action.mutate({ action: "openFolder", category: row.category })}
                onClear={
                  row.category === "screenshots" && row.bytes > 0
                    ? () => setPending({ kind: "clearScreenshots", bytes: row.bytes })
                    : row.category === "logs"
                      ? () => setPending({ kind: "clearOldLogs" })
                      : undefined
                }
              />
            ))}
          </div>
          {installed.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-text-primary">Installed speech models</h4>
              <div className="divide-y divide-border rounded-lg border border-border bg-bg-secondary">
                {installed.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                      {m.name}
                    </span>
                    <span className="text-[11px] text-text-muted">
                      {formatBytes(m.installedBytes)}
                    </span>
                    <button
                      type="button"
                      className={BUTTON}
                      onClick={() =>
                        setPending({
                          kind: "deleteModel",
                          id: m.id,
                          name: m.name,
                          bytes: m.installedBytes,
                        })
                      }
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {report.browserPartitions.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-text-primary">Browser panes by project</h4>
              <p className="text-[11px] text-text-muted">
                Clearing the cache keeps cookies and site data, so logins stay.
              </p>
              <div className="divide-y divide-border rounded-lg border border-border bg-bg-secondary">
                {report.browserPartitions.map((p) => (
                  <div key={p.projectId} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                      {p.projectName}
                    </span>
                    <span className="text-[11px] text-text-muted">
                      {formatBytes(p.bytes)} · cache {formatBytes(p.cacheBytes)}
                    </span>
                    <button
                      type="button"
                      className={BUTTON}
                      disabled={p.cacheBytes === 0}
                      onClick={() =>
                        setPending({
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
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={confirmTitle(pending)}
        description={confirmText(pending)}
        confirmLabel={pending?.kind === "deleteModel" ? "Delete" : "Clear"}
        variant="destructive"
        onConfirm={confirm}
      />
    </div>
  );
}

function confirmTitle(pending: Pending | null): string {
  if (pending?.kind === "clearScreenshots") return "Clear screenshots?";
  if (pending?.kind === "clearOldLogs") return "Clear old logs?";
  if (pending?.kind === "deleteModel") return "Delete model?";
  return "Clear browser cache?";
}

function confirmText(pending: Pending | null): string {
  if (!pending) return "";
  if (pending.kind === "clearScreenshots") {
    return `Deletes the agent browser screenshots (${formatBytes(pending.bytes)}).`;
  }
  if (pending.kind === "clearOldLogs") {
    return "Deletes the logs of earlier sessions. This session's log stays. Bug reports include fewer past warnings afterwards.";
  }
  if (pending.kind === "deleteModel") {
    return `Removes ${pending.name} (${formatBytes(pending.bytes)}). You can download it again from the Models tab.`;
  }
  return `Deletes ${formatBytes(pending.bytes)} of cached pages for ${pending.projectName}. Cookies and logins stay.`;
}

function StorageRowView({
  row,
  onOpen,
  onClear,
}: {
  row: StorageRow;
  onOpen: () => void;
  onClear?: () => void;
}) {
  const hint = HINTS[row.category];
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-text-primary">{row.label}</div>
        {hint && <div className="text-[11px] text-text-muted">{hint}</div>}
      </div>
      <span className="text-xs tabular-nums text-text-secondary">{formatBytes(row.bytes)}</span>
      {onClear && (
        <button type="button" className={BUTTON} onClick={onClear}>
          <Trash2 className="h-3 w-3" /> {row.category === "logs" ? "Clear old" : "Clear"}
        </button>
      )}
      <button type="button" className={BUTTON} disabled={!row.path} onClick={onOpen}>
        <FolderOpen className="h-3 w-3" /> Open
      </button>
    </div>
  );
}
