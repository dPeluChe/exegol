import { cn } from "@exegol/ui";
import type { TaskItem } from "../../../../lib/markdown-tasks";
import { PRIORITY_BADGE_COLORS } from "./config";

/** Tag, assigned-agent and priority chips; the caller owns the wrapper and chip sizing. */
export function TaskBadges({ task, badgeClassName }: { task: TaskItem; badgeClassName: string }) {
  return (
    <>
      {task.tags.map((tag) => (
        <span key={tag} className={cn(badgeClassName, "bg-accent/10 text-accent")}>
          #{tag}
        </span>
      ))}
      {task.assignedAgent && (
        <span className={cn(badgeClassName, "bg-purple-500/10 text-purple-400")}>
          @{task.assignedAgent}
        </span>
      )}
      {task.priority && (
        <span className={cn(badgeClassName, PRIORITY_BADGE_COLORS[task.priority])}>
          !{task.priority}
        </span>
      )}
    </>
  );
}
