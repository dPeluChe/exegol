import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useSidecarHealth } from "../../hooks/use-sidecar-health";
import { trpcMutate } from "../../lib/trpc-client";
import { toastError, useToastStore } from "../../stores/toasts";
import { ConfirmDialog } from "./ConfirmDialog";

/** Shown while the PTY sidecar does not answer; clears by itself once it does. What was typed
 *  meanwhile is not re-sent: it could reach an agent late or twice. Also while the sidecar is
 *  from before this macOS login (`oldLogin`), until dismissed */
export function SidecarHealthBanner() {
  const health = useSidecarHealth();
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [dismissed, setDismissed] = useState(false);

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

  if (!health.stalled && (!health.oldLogin || dismissed)) return null;
  const since = health.since
    ? new Date(health.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  // A stall comes first: its Retry is the urgent one
  const view = health.stalled
    ? {
        text: `Terminals are not responding${since ? ` since ${since}` : ""}. Keys typed meanwhile may be lost.`,
        label: retry.isPending ? "Retrying…" : "Retry",
        act: () => retry.mutate(),
      }
    : {
        text: "These terminals started before your last macOS login: copying, network names and saved logins may fail in them.",
        label: "Dismiss",
        act: () => setDismissed(true),
      };

  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 bg-amber-500/10 px-3 py-1.5 text-[11px]"
    >
      <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
      <span className="text-amber-200">{view.text}</span>
      <button
        type="button"
        disabled={retry.isPending || restart.isPending}
        onClick={view.act}
        className="ml-1 rounded border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
      >
        {view.label}
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
