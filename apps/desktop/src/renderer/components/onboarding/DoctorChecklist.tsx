import { AlertTriangle, Check, CheckCircle2, Copy, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import { FilterChip } from "../common/FilterChip";
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

/** Reports from an older main process lack `category` — derive it from the id. */
export function resolveCategory(check: DoctorCheck): DoctorCategory {
  if (check.category) return check.category;
  if (check.id.startsWith("cli:")) return "agents";
  if (check.id === "keystore" || check.id === "api-keys" || check.id === "stale-worktrees") {
    return "config";
  }
  return "system";
}

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
  /** Onboarding: CLIs you don't have are options, not problems; they fold into one line */
  foldMissingClis?: boolean;
}

/** A CLI that simply is not installed (as opposed to a broken or doubled install) */
function isMissingCli(check: DoctorCheck): boolean {
  return (
    resolveCategory(check) === "agents" && check.status !== "ok" && /not found/i.test(check.detail)
  );
}

export function DoctorChecklist({
  checks,
  isLoading,
  onRefresh,
  isRefreshing,
  generatedAt,
  defaultOnlyIssues = false,
  foldMissingClis = false,
}: DoctorChecklistProps) {
  const missing = foldMissingClis ? checks.filter(isMissingCli) : [];
  const [showMissing, setShowMissing] = useState(false);
  const issueCount = checks.filter((c) => c.status !== "ok" && !missing.includes(c)).length;
  // What actually needs review is the warns — default to them when any exist.
  const [onlyIssues, setOnlyIssues] = useState(defaultOnlyIssues);

  if (isLoading) {
    return <p className="text-xs text-text-muted">Running health checks...</p>;
  }

  const showOnlyIssues = onlyIssues && issueCount > 0;
  const listed = checks.filter((c) => !missing.includes(c));
  const visible = showOnlyIssues ? listed.filter((c) => c.status !== "ok") : listed;

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
        const group = visible.filter((c) => resolveCategory(c) === category);
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
            {group.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
            {category === "agents" && missing.length > 0 && (
              <div className="rounded-md border border-dashed border-border px-3 py-2">
                <button
                  type="button"
                  onClick={() => setShowMissing((v) => !v)}
                  className="w-full text-left text-[11px] text-text-muted hover:text-text-secondary"
                >
                  {showMissing ? "Hide" : "Show"} {missing.length} more CLI
                  {missing.length === 1 ? "" : "s"} you can install later (optional)
                </button>
                {showMissing && (
                  <div className="mt-2 space-y-1.5">
                    {missing.map((check) => (
                      <CheckRow key={check.id} check={check} muted />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A vendor command to paste in a terminal, one click to copy */
function CopyCommand({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard
          .writeText(command)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {})
      }
      className="mt-1 flex w-full min-w-0 items-center gap-1.5 rounded bg-bg-primary px-2 py-1 text-left font-mono text-[10px] text-text-secondary hover:text-text-primary"
      title={`${label}: click to copy`}
    >
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-success" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 text-text-muted" />
      )}
      <span className="min-w-0 truncate">{command}</span>
    </button>
  );
}

function CheckRow({ check, muted }: { check: DoctorCheck; muted?: boolean }) {
  const Icon = STATUS_ICON[check.status];
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-border bg-bg-tertiary px-3 py-2">
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${muted ? "text-text-muted" : STATUS_COLOR[check.status]}`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text-primary">{check.label}</div>
        <div className="text-[11px] text-text-muted">{check.detail}</div>
        {check.installCommand && <CopyCommand label="Install" command={check.installCommand} />}
        {check.updateCommand && (
          <details className="mt-0.5 text-[10px] text-text-muted">
            <summary className="cursor-pointer hover:text-text-secondary">Update command</summary>
            <CopyCommand label="Update" command={check.updateCommand} />
          </details>
        )}
      </div>
      {check.actionUrl && (
        <button
          type="button"
          onClick={() => window.open(check.actionUrl, "_blank")}
          className="shrink-0 text-[11px] text-accent hover:underline"
        >
          {/* With a command to copy the link is the docs; alone it is where to get it */}
          {check.installCommand ? "Docs" : "Install"}
        </button>
      )}
    </div>
  );
}
