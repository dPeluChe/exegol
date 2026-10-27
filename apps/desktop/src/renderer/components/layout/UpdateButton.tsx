import { cn } from "@exegol/ui";
import type { LucideIcon } from "lucide-react";
import { ArrowDownCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  type UpdateState,
  type UpdateStatus,
  useCheckForUpdates,
  useUpdateStatus,
} from "../../hooks/use-update-status";
import { ReleaseNotesDialog, useUpdateNotes } from "./ReleaseNotesDialog";

interface View {
  Icon: LucideIcon;
  title: string;
  tone?: string;
  badge?: ReactNode;
  spin?: boolean;
  onClick?: () => void;
}

function viewFor(
  status: UpdateState,
  info: UpdateStatus["info"],
  check: () => void,
  showNotes: () => void,
): View {
  switch (status) {
    case "checking":
      return { Icon: Loader2, title: "Checking for updates...", spin: true };
    case "available":
      return {
        Icon: Loader2,
        title: `Update ${info.version ?? ""} found, downloading: click to see what's new`,
        spin: true,
        onClick: showNotes,
      };
    case "downloading":
      return {
        Icon: Loader2,
        title: `Downloading update ${info.percent ?? 0}%: click to see what's new`,
        badge: <span className="tabular-nums">{info.percent ?? 0}%</span>,
        spin: true,
        onClick: showNotes,
      };
    case "ready":
      return {
        Icon: ArrowDownCircle,
        title: `Exegol ${info.version ?? ""} is ready: see what's new and restart to install`,
        tone: "text-green-400",
        badge: <span>Restart to update</span>,
        onClick: showNotes,
      };
    case "up-to-date":
      return {
        Icon: CheckCircle2,
        title: "Exegol is up to date",
        badge: <span>Up to date</span>,
        onClick: check,
      };
    case "error":
      return {
        Icon: RefreshCw,
        title: `Update check failed: ${info.message ?? "unknown"}. Click to retry`,
        tone: "text-red-400",
        onClick: check,
      };
    default:
      return { Icon: RefreshCw, title: "Check for updates", onClick: check };
  }
}

/** `percent` undefined: found, no progress event yet */
function DownloadProgress({ percent }: { percent?: number }) {
  const indeterminate = percent === undefined;
  return (
    <div className="flex items-center gap-2 text-[11px] text-text-muted">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1 w-28 overflow-hidden rounded bg-bg-tertiary"
      >
        <div
          className={cn(
            "h-full bg-accent transition-[width]",
            indeterminate && "w-1/3 animate-pulse",
          )}
          style={indeterminate ? undefined : { width: `${percent}%` }}
        />
      </div>
      <span className="tabular-nums">
        {indeterminate ? "Downloading" : `Downloading ${percent}%`}; it installs when you restart
      </span>
    </div>
  );
}

/**
 * Title-bar update control: check now, see it download, restart to install. The updater only
 * checked 10s after launch and every 4h, so testing a release meant restarting the app.
 */
export function UpdateButton() {
  const { status, info } = useUpdateStatus();
  const checkNow = useCheckForUpdates();
  const [notesOpen, setNotesOpen] = useState(false);
  // Only a check the user asked for opens the notes by itself: a background check must not
  // pop a dialog over whatever they are typing
  const [manualCheck, setManualCheck] = useState(false);
  const [seenStatus, setSeenStatus] = useState(status);
  if (status !== seenStatus) {
    setSeenStatus(status);
    if (status === "available" && manualCheck) setNotesOpen(true);
    if (status !== "checking") setManualCheck(false);
  }
  const updateVersion = info.version;
  const notes = useUpdateNotes(updateVersion, notesOpen);

  const check = () => {
    setManualCheck(true);
    checkNow();
  };

  const { Icon, title, tone, badge, spin, onClick } = viewFor(status, info, check, () =>
    setNotesOpen(true),
  );

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex h-6 items-center gap-1 rounded px-1.5 text-[10px] transition-colors hover:bg-white/10",
          tone ?? "text-text-muted hover:text-text-primary",
        )}
        title={title}
      >
        <Icon className={cn("h-3.5 w-3.5", spin && "animate-spin")} />
        {badge}
      </button>
      <ReleaseNotesDialog
        open={notesOpen}
        onOpenChange={setNotesOpen}
        title={`What's new in Exegol ${updateVersion ?? ""}`}
        notes={notes.data ?? []}
        loading={notes.isLoading}
        footer={
          status === "ready" ? (
            <button
              type="button"
              onClick={() => window.api?.updater?.install?.()}
              className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/90"
            >
              Restart to update
            </button>
          ) : status === "error" ? (
            <span className="text-[11px] text-error">
              Update failed; retry from the update button
            </span>
          ) : status === "available" || status === "downloading" ? (
            <DownloadProgress
              percent={status === "downloading" ? (info.percent ?? 0) : undefined}
            />
          ) : undefined
        }
      />
    </>
  );
}
