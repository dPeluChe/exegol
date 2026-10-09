import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useSidecarHealth } from "../../hooks/use-sidecar-health";
import { trpcMutate } from "../../lib/trpc-client";
import { toastError, useToastStore } from "../../stores/toasts";
import { ConfirmDialog } from "./ConfirmDialog";

/** Shown while the PTY sidecar does not answer; clears by itself once it does. What was typed
 *  meanwhile is not re-sent: it could reach an agent late or twice */
export function SidecarHealthBanner() {
  const health = useSidecarHealth();
  const [confirmRestart, setConfirmRestart] = useState(false);

  const retry = useMutation({
    mutationFn: () => trpcMutate<{ ok: boolean }>("sidecar.retry"),
    onSuccess: ({ ok }) => {
      if (!ok) {
        useToastStore.getState().addToast({
          type: "warning",
          title: "Terminals are still not responding",
          body: "Try again in a moment, or restart the terminals.",
        });
      }
    },
    onError: toastError("Retry failed"),
  });
  const restart = useMutation({
    mutationFn: () => trpcMutate("sidecar.restart"),
    onError: toastError("Could not restart the terminals"),
  });

  if (!health.stalled) return null;
  const since = health.since
    ? new Date(health.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 bg-amber-500/10 px-3 py-1.5 text-[11px]"
    >
      <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
      <span className="text-amber-200">
        Terminals are not responding{since ? ` since ${since}` : ""}. Keys typed meanwhile may be
        lost.
      </span>
      <button
        type="button"
        disabled={retry.isPending || restart.isPending}
        onClick={() => retry.mutate()}
        className="ml-1 rounded border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
      >
        {retry.isPending ? "Retrying…" : "Retry"}
      </button>
      <button
        type="button"
        disabled={restart.isPending}
        onClick={() => setConfirmRestart(true)}
        className="rounded px-2 py-0.5 text-[10px] font-medium text-text-muted hover:bg-white/5 hover:text-text-primary disabled:opacity-50"
      >
        Restart terminals
      </button>
      <ConfirmDialog
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        title="Restart terminals?"
        description="Every live session ends now and Exegol restarts. Sessions come back as crashed with their history, ready to resume."
        confirmLabel="Restart terminals"
        variant="destructive"
        autoFocusCancel
        onConfirm={() => restart.mutate()}
      />
    </div>
  );
}
