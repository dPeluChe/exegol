import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import type { DoctorCheck, DoctorStatus } from "./use-doctor";

const STATUS_ICON: Record<DoctorStatus, typeof CheckCircle2> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
};

const STATUS_COLOR: Record<DoctorStatus, string> = {
  ok: "text-success",
  warn: "text-warning",
  fail: "text-error",
};

interface DoctorChecklistProps {
  checks: DoctorCheck[];
  isLoading?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function DoctorChecklist({
  checks,
  isLoading,
  onRefresh,
  isRefreshing,
}: DoctorChecklistProps) {
  if (isLoading) {
    return <p className="text-xs text-text-muted">Running health checks...</p>;
  }

  return (
    <div className="space-y-3">
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
          Re-run checks
        </button>
      )}
      <div className="space-y-1.5">
        {checks.map((check) => {
          const Icon = STATUS_ICON[check.status];
          return (
            <div
              key={check.id}
              className="flex items-start gap-2.5 rounded-md border border-border bg-bg-tertiary px-3 py-2"
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${STATUS_COLOR[check.status]}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text-primary">{check.label}</div>
                <div className="text-[11px] text-text-muted">{check.detail}</div>
              </div>
              {check.actionUrl && (
                <button
                  type="button"
                  onClick={() => window.open(check.actionUrl, "_blank")}
                  className="shrink-0 text-[11px] text-accent hover:underline"
                >
                  Install
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
