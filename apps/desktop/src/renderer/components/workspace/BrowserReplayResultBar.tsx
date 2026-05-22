import { cn } from "@exegol/ui";
import { CheckCircle, XCircle } from "lucide-react";
import type { QaReplayResult } from "../../lib/qa-replay";

interface BrowserReplayResultBarProps {
  replayResult: QaReplayResult;
  onDismiss: () => void;
}

export function BrowserReplayResultBar({ replayResult, onDismiss }: BrowserReplayResultBarProps) {
  return (
    <div
      className={cn(
        "shrink-0 border-t border-border px-3 py-2",
        replayResult.passed ? "bg-green-500/5" : "bg-red-500/5",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex items-center gap-1 text-[10px] font-medium",
            replayResult.passed ? "text-green-300" : "text-red-300",
          )}
        >
          {replayResult.passed ? (
            <CheckCircle className="h-3 w-3" />
          ) : (
            <XCircle className="h-3 w-3" />
          )}
          {replayResult.passed
            ? "All steps passed"
            : `${replayResult.stepResults.filter((s) => !s.passed).length} step(s) failed`}
          <span className="text-text-muted">· {replayResult.totalDurationMs}ms</span>
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-1.5 py-0.5 text-[9px] text-text-muted hover:bg-white/5"
        >
          Dismiss
        </button>
      </div>
      {replayResult.stepResults.some(
        (s) => !s.passed || s.alertsDetected?.length || s.newConsoleErrors?.length,
      ) && (
        <div className="mt-1 space-y-1">
          {replayResult.stepResults
            .filter((s) => !s.passed || s.alertsDetected?.length || s.newConsoleErrors?.length)
            .map((s) => (
              <div key={s.actionIndex} className="space-y-0.5">
                {!s.passed && (
                  <p className="truncate text-[9px] text-red-400">
                    Step {s.actionIndex + 1}: {s.error}
                  </p>
                )}
                {s.alertsDetected?.map((t) => (
                  <p key={t} className="truncate text-[9px] text-amber-300" title={t}>
                    Step {s.actionIndex + 1} alert: {t}
                  </p>
                ))}
                {s.newConsoleErrors?.map((e) => (
                  <p key={e} className="truncate text-[9px] text-amber-400/70" title={e}>
                    Step {s.actionIndex + 1} console.error: {e}
                  </p>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
