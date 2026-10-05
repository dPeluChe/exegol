// T44: Auto-update notification banner.
// Shows the updater's shared status when there is something to act on.

import { Download, RefreshCw, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useUpdateStatus } from "../../hooks/use-update-status";

export function UpdateBanner() {
  const update = useUpdateStatus();
  // What was dismissed: a new version, or the download becoming ready, shows again
  const [dismissed, setDismissed] = useState<string | null>(null);
  const dismissKey = `${update.status === "ready" ? "ready" : "found"}:${update.info.version}`;

  const handleInstall = useCallback(() => {
    window.api?.updater?.install?.();
  }, []);

  const handleCheck = useCallback(() => {
    window.api?.updater?.check?.();
  }, []);

  // Only show for actionable states
  if (dismissed === dismissKey) return null;
  if (update.status === "idle" || update.status === "up-to-date" || update.status === "checking") {
    return null;
  }

  return (
    <div className="flex shrink-0 items-center gap-2 bg-accent/10 px-3 py-1.5 text-[11px]">
      {update.status === "available" && (
        <>
          <Download className="h-3.5 w-3.5 text-accent" />
          <span className="text-accent">
            Update {update.info.version ?? ""} available — downloading...
          </span>
        </>
      )}

      {update.status === "downloading" && (
        <>
          <Download className="h-3.5 w-3.5 animate-pulse text-accent" />
          <span className="text-accent">Downloading update... {update.info.percent ?? 0}%</span>
        </>
      )}

      {update.status === "ready" && (
        <>
          <RefreshCw className="h-3.5 w-3.5 text-green-400" />
          <span className="text-green-300">Update {update.info.version ?? ""} ready</span>
          <button
            type="button"
            onClick={handleInstall}
            className="ml-1 rounded border border-green-500/30 px-2 py-0.5 text-[10px] font-medium text-green-300 hover:bg-green-500/10"
          >
            Restart to install
          </button>
        </>
      )}

      {update.status === "error" && (
        <>
          <span className="text-red-300">Update error: {update.info.message ?? "Unknown"}</span>
          <button
            type="button"
            onClick={handleCheck}
            className="ml-1 text-[10px] text-accent hover:underline"
          >
            Retry
          </button>
        </>
      )}

      <button
        type="button"
        onClick={() => setDismissed(dismissKey)}
        className="ml-auto text-text-muted hover:text-text-primary"
        title="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
