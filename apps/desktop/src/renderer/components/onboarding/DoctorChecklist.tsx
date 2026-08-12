import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import type { DoctorCategory, DoctorCheck, DoctorStatus } from "./use-doctor";

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

const CATEGORY_ORDER: DoctorCategory[] = ["agents", "system", "config"];

const CATEGORY_META: Record<DoctorCategory, { label: string; badge: string }> = {
  agents: { label: "Agent CLIs", badge: "bg-accent/15 text-accent" },
  system: { label: "System & services", badge: "bg-blue-500/15 text-blue-300" },
  config: { label: "Configuration", badge: "bg-purple-500/15 text-purple-300" },
};

interface DoctorChecklistProps {
  checks: DoctorCheck[];
  isLoading?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** Unix ms of the last completed run — visible proof that re-run did something. */
  generatedAt?: number;
  /** Start filtered to warns/fails (Settings > Doctor). Onboarding shows all. */
  defaultOnlyIssues?: boolean;
}

export function DoctorChecklist({
  checks,
  isLoading,
  onRefresh,
  isRefreshing,
  generatedAt,
  defaultOnlyIssues = false,
}: DoctorChecklistProps) {
  const issueCount = checks.filter((c) => c.status !== "ok").length;
  // What actually needs review is the warns — default to them when any exist.
  const [onlyIssues, setOnlyIssues] = useState(defaultOnlyIssues);

  if (isLoading) {
    return <p className="text-xs text-text-muted">Running health checks...</p>;
  }

  const showOnlyIssues = onlyIssues && issueCount > 0;
  const visible = showOnlyIssues ? checks.filter((c) => c.status !== "ok") : checks;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Running checks..." : "Re-run checks"}
          </button>
        )}
        {generatedAt && !isRefreshing && (
          <span className="text-[10px] text-text-muted">
            Last run {new Date(generatedAt).toLocaleTimeString()}
          </span>
        )}
        {issueCount > 0 && (
          <div className="ml-auto flex items-center gap-1">
            <FilterChip active={onlyIssues} onClick={() => setOnlyIssues(true)}>
              Needs review ({issueCount})
            </FilterChip>
            <FilterChip active={!onlyIssues} onClick={() => setOnlyIssues(false)}>
              All ({checks.length})
            </FilterChip>
          </div>
        )}
      </div>

      {visible.length === 0 && (
        <p className="text-xs text-success">All checks passed — nothing needs review.</p>
      )}

      {CATEGORY_ORDER.map((category) => {
        const group = visible.filter((c) => (c.category ?? "system") === category);
        if (group.length === 0) return null;
        const meta = CATEGORY_META[category];
        return (
          <div key={category} className="space-y-1.5">
            <div className="flex items-center gap-2 pt-1">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${meta.badge}`}
              >
                {meta.label}
              </span>
              <span className="text-[10px] text-text-muted">{group.length}</span>
            </div>
            {group.map((check) => {
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
        );
      })}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
        active
          ? "bg-white/10 text-text-primary"
          : "text-text-muted hover:bg-white/5 hover:text-text-secondary"
      }`}
    >
      {children}
    </button>
  );
}
