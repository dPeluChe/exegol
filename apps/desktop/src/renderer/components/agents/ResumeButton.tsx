import { cn } from "@exegol/ui";
import { Play, RotateCcw } from "lucide-react";
import { type ResumeSource, useResumeAgent } from "../../hooks/use-resume-agent";

/** Resume an ended session where it is listed (Dashboard cards), without opening its pane */
export function ResumeButton({ agent, className }: { agent: ResumeSource; className?: string }) {
  const { resume, pending, resumableCliTypes } = useResumeAgent();
  const canResume = resumableCliTypes.has(agent.cliType);
  const Icon = canResume ? Play : RotateCcw;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        resume(agent).catch(() => {});
      }}
      className={cn(
        "flex items-center gap-0.5 rounded border border-accent/30 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10 disabled:opacity-50",
        className,
      )}
      title={canResume ? "Continue this session" : "Start it again with the same task"}
    >
      <Icon className="h-3 w-3" />
      {pending ? "Starting..." : canResume ? "Resume" : "Re-launch"}
    </button>
  );
}
