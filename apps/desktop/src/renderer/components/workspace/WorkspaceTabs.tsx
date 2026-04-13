import { cn } from "@exegol/ui";
import { BarChart3, Cpu, FolderKanban, type LucideIcon } from "lucide-react";

// ─── Main tabs (3 top-level) ────────────────────────────────────────────────

export type MainTab = "agents" | "project" | "monitor";

const MAIN_TABS: { id: MainTab; label: string; icon: LucideIcon }[] = [
  { id: "agents", label: "Agents", icon: Cpu },
  { id: "project", label: "Project", icon: FolderKanban },
  { id: "monitor", label: "Monitor", icon: BarChart3 },
];

// ─── Sub-tabs per main tab ──────────────────────────────────────────────────

export type ProjectSubTab = "tasks" | "prompts-skills" | "memory" | "pipelines";
export type MonitorSubTab = "agent-dashboard" | "resources-tokens" | "scoring";

export type WorkspaceSection =
  | "agents"
  | "tasks"
  | "prompts-skills"
  | "memory"
  | "pipelines"
  | "agent-dashboard"
  | "resources-tokens"
  | "scoring";

const PROJECT_SUBS: { id: ProjectSubTab; label: string }[] = [
  { id: "tasks", label: "Tasks" },
  { id: "prompts-skills", label: "Prompts & Skills" },
  { id: "memory", label: "Memory" },
  { id: "pipelines", label: "Pipelines" },
];

const MONITOR_SUBS: { id: MonitorSubTab; label: string }[] = [
  { id: "agent-dashboard", label: "Agent Dashboard" },
  { id: "resources-tokens", label: "Resources & Tokens" },
  { id: "scoring", label: "Scoring" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getMainTab(section: WorkspaceSection): MainTab {
  if (section === "agents") return "agents";
  if (
    section === "tasks" ||
    section === "prompts-skills" ||
    section === "memory" ||
    section === "pipelines"
  )
    return "project";
  return "monitor";
}

export function getDefaultSubTab(tab: MainTab): WorkspaceSection {
  if (tab === "agents") return "agents";
  if (tab === "project") return "tasks";
  return "resources-tokens";
}

// ─── Component ──────────────────────────────────────────────────────────────

interface WorkspaceTabsProps {
  activeSection: WorkspaceSection;
  onSectionChange: (section: WorkspaceSection) => void;
}

export function WorkspaceTabs({ activeSection, onSectionChange }: WorkspaceTabsProps) {
  const activeMainTab = getMainTab(activeSection);

  const subTabs =
    activeMainTab === "project" ? PROJECT_SUBS : activeMainTab === "monitor" ? MONITOR_SUBS : null;

  return (
    <div className="shrink-0 border-b border-border bg-bg-secondary">
      {/* Main tabs */}
      <div className="flex h-9 items-center gap-0 overflow-x-auto">
        {MAIN_TABS.map(({ id, label, icon: Icon }) => {
          const isActive = activeMainTab === id;
          return (
            <button
              type="button"
              key={id}
              onClick={() => onSectionChange(getDefaultSubTab(id))}
              className={cn(
                "relative flex h-full items-center gap-1.5 px-4 text-[11px] font-semibold transition-colors",
                "hover:text-text-primary",
                isActive ? "text-text-primary" : "text-text-muted",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-nowrap">{label}</span>
              {isActive && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>

      {/* Sub-tabs (only for project and monitor) */}
      {subTabs && (
        <div className="flex h-7 items-center gap-0 overflow-x-auto border-t border-border/50 bg-bg-primary/50 px-2">
          {subTabs.map(({ id, label }) => {
            const isActive = activeSection === id;
            return (
              <button
                type="button"
                key={id}
                onClick={() => onSectionChange(id as WorkspaceSection)}
                className={cn(
                  "relative flex h-full items-center px-3 text-[10px] font-medium transition-colors",
                  "hover:text-text-primary",
                  isActive ? "text-accent" : "text-text-muted",
                )}
              >
                <span className="whitespace-nowrap">{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
