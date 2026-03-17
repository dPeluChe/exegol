import { Clock } from "lucide-react";
import { EmptyState } from "../../common/EmptyState";

export function SchedulerSection() {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="mb-2 rounded-full bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
        Coming Soon
      </div>
      <EmptyState
        icon={<Clock className="h-8 w-8 text-text-muted" />}
        title="Scheduler"
        description="Schedule recurring agent tasks with natural language prompts. Configure cron-like cadence."
        action={{ label: "Coming in Phase 2", onClick: () => {} }}
      />
    </div>
  );
}
