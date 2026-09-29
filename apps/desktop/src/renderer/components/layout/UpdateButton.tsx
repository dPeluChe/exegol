import { cn } from "@exegol/ui";
import { ArrowDownCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Status = "idle" | "checking" | "available" | "downloading" | "ready" | "up-to-date" | "error";

/**
 * Title-bar update control: check now, see it download, restart to install. The updater only
 * checked 10s after launch and every 4h, so testing a release meant restarting the app.
 */
export function UpdateButton() {
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState<{ version?: string; percent?: number; message?: string }>({});
  const settleRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const unsub = window.api?.updater?.onStatus?.((data: unknown) => {
      const next = data as { status: Status; info?: typeof info };
      clearTimeout(settleRef.current);
      setStatus(next.status);
      setInfo(next.info ?? {});
      // "Up to date" is a moment, not a state to keep on screen
      if (next.status === "up-to-date") {
        settleRef.current = setTimeout(() => setStatus("idle"), 4_000);
      }
    });
    return () => {
      clearTimeout(settleRef.current);
      unsub?.();
    };
  }, []);

  const check = () => {
    setStatus("checking");
    window.api?.updater?.check?.();
    // Dev builds and silenced errors answer nothing: do not spin forever
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => setStatus((s) => (s === "checking" ? "idle" : s)), 15_000);
  };

  const ready = status === "ready";
  const busy = status === "checking" || status === "downloading" || status === "available";
  const Icon = ready
    ? ArrowDownCircle
    : status === "up-to-date"
      ? CheckCircle2
      : busy
        ? Loader2
        : RefreshCw;
  const title = ready
    ? `Exegol ${info.version ?? ""} is ready: click to restart and install`
    : status === "downloading"
      ? `Downloading update ${info.percent ?? 0}%`
      : status === "available"
        ? `Update ${info.version ?? ""} found, downloading`
        : status === "checking"
          ? "Checking for updates..."
          : status === "up-to-date"
            ? "Exegol is up to date"
            : status === "error"
              ? `Update check failed: ${info.message ?? "unknown"}. Click to retry`
              : "Check for updates";

  return (
    <button
      type="button"
      onClick={() => (ready ? window.api?.updater?.install?.() : busy ? undefined : check())}
      className={cn(
        "flex h-6 items-center gap-1 rounded px-1.5 text-[10px] transition-colors hover:bg-white/10",
        ready
          ? "text-green-400"
          : status === "error"
            ? "text-red-400"
            : "text-text-muted hover:text-text-primary",
      )}
      title={title}
    >
      <Icon className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
      {status === "downloading" && <span className="tabular-nums">{info.percent ?? 0}%</span>}
      {ready && <span>Restart to update</span>}
      {status === "up-to-date" && <span>Up to date</span>}
    </button>
  );
}
