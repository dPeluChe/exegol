import type { StorageCategory, StorageReport, StorageRow } from "@exegol/shared";
import { FolderOpen, HardDrive, LayoutDashboard, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useRefreshStorage, useStorageAction, useStorageReport } from "../../hooks/use-trpc-models";
import { storageBarSegments } from "../../lib/storage-overview";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { type SegmentedTab, SegmentedTabs } from "../common/SegmentedTabs";
import { formatBytes } from "../workspace/sections/resource-format";
import { SpeechModelList } from "./ModelsSettings";
import { SMALL_BUTTON } from "./settings-ui";
import { BrowserPanel, OtherPanel, type Pending, WorktreesPanel } from "./storage-panels";

type StorageTab = "overview" | "models" | "browser" | "worktrees" | "other";

const TABS: SegmentedTab<StorageTab>[] = [
  { id: "overview", label: "Overview" },
  { id: "models", label: "Speech models" },
  { id: "browser", label: "Browser" },
  { id: "worktrees", label: "Worktrees" },
  { id: "other", label: "Other" },
];

const CATEGORY_COLOR: Record<StorageCategory, string> = {
  models: "bg-accent",
  scrollback: "bg-info",
  screenshots: "bg-success",
  logs: "bg-warning",
  database: "bg-error",
  worktrees: "bg-accent/50",
  browser: "bg-info/50",
  other: "bg-text-muted",
};

const HINTS: Partial<Record<StorageCategory, string>> = {
  worktrees: "Clean them up from the Dashboard's Worktrees card: a worktree can hold work.",
  scrollback: "Saved terminal output of agents, kept for their history.",
  database: "Projects, agents, history and settings.",
};

// The settings window lives for the session: reopening Storage lands on the last tab
let lastTab: StorageTab = "overview";

export function StorageSettings() {
  const { data: report, isLoading } = useStorageReport();
  const refresh = useRefreshStorage();
  const action = useStorageAction();
  const [tab, setTab] = useState<StorageTab>(lastTab);
  const [pending, setPending] = useState<Pending | null>(null);

  const selectTab = (next: StorageTab) => {
    lastTab = next;
    setTab(next);
  };

  const confirm = () => {
    if (!pending) return;
    if (pending.kind === "clearBrowserCache") {
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
          className={`${SMALL_BUTTON} ml-auto`}
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw className={`h-3 w-3 ${refresh.isPending ? "animate-spin" : ""}`} /> Recount
        </button>
      </div>
      <SegmentedTabs tabs={TABS} active={tab} onChange={selectTab} />
      {tab === "models" && (
        <div className="space-y-2">
          <p className="text-[11px] text-text-muted">
            Dictation uses the default model. Download another to try it, then set it as default.
          </p>
          <SpeechModelList installedFirst />
        </div>
      )}
      {tab === "worktrees" && <WorktreesPanel />}
      {tab !== "models" && tab !== "worktrees" && (
        <>
          {isLoading && <p className="text-xs text-text-muted">Measuring disk use...</p>}
          {report && tab === "overview" && (
            <OverviewPanel
              report={report}
              onPending={setPending}
              onShowOther={() => selectTab("other")}
            />
          )}
          {report && tab === "browser" && (
            <BrowserPanel partitions={report.browserPartitions} onPending={setPending} />
          )}
          {report && tab === "other" && <OtherPanel entries={report.otherEntries} />}
        </>
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={confirmTitle(pending)}
        description={confirmText(pending)}
        confirmLabel="Clear"
        variant="destructive"
        onConfirm={confirm}
      />
    </div>
  );
}

function OverviewPanel({
  report,
  onPending,
  onShowOther,
}: {
  report: StorageReport;
  onPending: (pending: Pending) => void;
  onShowOther: () => void;
}) {
  const action = useStorageAction();
  const segments = storageBarSegments(report.rows);
  return (
    <div className="space-y-3">
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
      {segments.length > 0 && (
        <div
          role="img"
          aria-label={`Disk use by category: ${segments.map((s) => `${s.label} ${s.percent}%`).join(", ")}`}
          className="flex h-2 overflow-hidden rounded-full bg-bg-tertiary"
        >
          {segments.map((s) => (
            <div
              key={s.category}
              className={CATEGORY_COLOR[s.category]}
              style={{ width: `${s.percent}%` }}
              title={`${s.label}: ${formatBytes(s.bytes)} (${s.percent}%)`}
            />
          ))}
        </div>
      )}
      <div className="divide-y divide-border rounded-lg border border-border bg-bg-secondary">
        {report.rows.map((row) => (
          <CategoryRow
            key={row.category}
            row={row}
            onOpen={() => action.mutate({ action: "openFolder", category: row.category })}
            onDetails={row.category === "other" ? onShowOther : undefined}
            onClear={
              row.category === "screenshots" && row.bytes > 0
                ? () => onPending({ kind: "clearScreenshots", bytes: row.bytes })
                : row.category === "logs"
                  ? () => onPending({ kind: "clearOldLogs" })
                  : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function confirmTitle(pending: Pending | null): string {
  if (pending?.kind === "clearScreenshots") return "Clear screenshots?";
  if (pending?.kind === "clearOldLogs") return "Clear old logs?";
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
  return `Deletes ${formatBytes(pending.bytes)} of cached pages for ${pending.projectName}. Cookies and logins stay.`;
}

function CategoryRow({
  row,
  onOpen,
  onClear,
  onDetails,
}: {
  row: StorageRow;
  onOpen: () => void;
  onClear?: () => void;
  onDetails?: () => void;
}) {
  const hint = HINTS[row.category];
  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5">
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${CATEGORY_COLOR[row.category]}`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-text-primary">{row.label}</div>
        {hint && <div className="truncate text-[10px] text-text-muted">{hint}</div>}
      </div>
      <span className="text-xs tabular-nums text-text-secondary">{formatBytes(row.bytes)}</span>
      {row.category === "worktrees" && (
        <button
          type="button"
          className={SMALL_BUTTON}
          onClick={() => window.api.settings.showDashboard()}
        >
          <LayoutDashboard className="h-3 w-3" /> Show in Dashboard
        </button>
      )}
      {onDetails && (
        <button type="button" className={SMALL_BUTTON} onClick={onDetails}>
          Details
        </button>
      )}
      {onClear && (
        <button type="button" className={SMALL_BUTTON} onClick={onClear}>
          <Trash2 className="h-3 w-3" /> {row.category === "logs" ? "Clear old" : "Clear"}
        </button>
      )}
      <button type="button" className={SMALL_BUTTON} disabled={!row.path} onClick={onOpen}>
        <FolderOpen className="h-3 w-3" /> Open
      </button>
    </div>
  );
}
