import { cn } from "@exegol/ui";
import type { LucideIcon } from "lucide-react";
import { ArrowDownCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

type Status = "idle" | "checking" | "available" | "downloading" | "ready" | "up-to-date" | "error";
type Info = { version?: string; percent?: number; message?: string };

interface View {
  Icon: LucideIcon;
  title: string;
  tone?: string;
  badge?: ReactNode;
  /** Absent while busy: the icon spins and clicks do nothing */
  onClick?: () => void;
}

function viewFor(status: Status, info: Info, check: () => void): View {
  switch (status) {
    case "checking":
      return { Icon: Loader2, title: "Checking for updates..." };
    case "available":
      return { Icon: Loader2, title: `Update ${info.version ?? ""} found, downloading` };
    case "downloading":
      return {
        Icon: Loader2,
        title: `Downloading update ${info.percent ?? 0}%`,
        badge: <span className="tabular-nums">{info.percent ?? 0}%</span>,
      };
    case "ready":
      return {
        Icon: ArrowDownCircle,
        title: `Exegol ${info.version ?? ""} is ready: click to restart and install`,
        tone: "text-green-400",
        badge: <span>Restart to update</span>,
        onClick: () => window.api?.updater?.install?.(),
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

/**
 * Title-bar update control: check now, see it download, restart to install. The updater only
 * checked 10s after launch and every 4h, so testing a release meant restarting the app.
 */
export function UpdateButton() {
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState<Info>({});
  const settleRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const unsub = window.api?.updater?.onStatus?.((data: unknown) => {
      const next = data as { status: Status; info?: Info };
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

  const { Icon, title, tone, badge, onClick } = viewFor(status, info, check);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-6 items-center gap-1 rounded px-1.5 text-[10px] transition-colors hover:bg-white/10",
        tone ?? "text-text-muted hover:text-text-primary",
      )}
      title={title}
    >
      <Icon className={cn("h-3.5 w-3.5", !onClick && "animate-spin")} />
      {badge}
    </button>
  );
}
