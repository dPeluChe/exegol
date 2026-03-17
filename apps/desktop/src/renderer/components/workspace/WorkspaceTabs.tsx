import { cn } from "@exegol/ui";
import {
  Activity,
  CheckSquare,
  Clock,
  Coins,
  Cpu,
  GitCompare,
  type LucideIcon,
} from "lucide-react";

export type WorkspaceSection = "agents" | "tasks" | "diff" | "scheduler" | "tokens" | "resources";

const SECTIONS: { id: WorkspaceSection; label: string; icon: LucideIcon }[] = [
  { id: "agents", label: "Agents", icon: Cpu },
  { id: "tasks", label: "Tasks", icon: CheckSquare },
  { id: "diff", label: "Diff Viewer", icon: GitCompare },
  { id: "scheduler", label: "Scheduler", icon: Clock },
  { id: "tokens", label: "Token Usage", icon: Coins },
  { id: "resources", label: "Resources", icon: Activity },
];

interface WorkspaceTabsProps {
  activeSection: WorkspaceSection;
  onSectionChange: (section: WorkspaceSection) => void;
}

export function WorkspaceTabs({ activeSection, onSectionChange }: WorkspaceTabsProps) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-0 overflow-x-auto border-b border-border bg-bg-secondary">
      {SECTIONS.map(({ id, label, icon: Icon }) => {
        const isActive = activeSection === id;

        return (
          <button
            type="button"
            key={id}
            onClick={() => onSectionChange(id)}
            className={cn(
              "relative flex h-full items-center gap-1.5 px-3 text-[11px] font-medium transition-colors",
              "hover:text-text-primary",
              isActive ? "text-text-primary" : "text-text-muted",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{label}</span>

            {/* Active indicator underline */}
            {isActive && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" />
            )}
          </button>
        );
      })}
    </div>
  );
}
