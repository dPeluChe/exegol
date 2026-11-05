import { cn } from "@exegol/ui";
import { BarChart3, ChevronLeft, FolderKanban, type LucideIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useProjectContext } from "../../contexts/ProjectContext";
import {
  groupOf,
  type MainTab,
  mainTabOf,
  SECTION_GROUPS,
  toggleMainTab,
  type WorkspaceSection,
} from "../../lib/workspace-sections";
import { useAgentStore } from "../../stores/agents";
import { collectPaneIds, selectPanes, selectTabs, useWorkspaceStore } from "../../stores/workspace";
import { tabDotClass, tabSignal } from "./tab-bar-helpers";
import { WorkspaceTabBar } from "./WorkspaceTabBar";

// The cross-project Dashboard is its own view (sidebar button, activeView
// "dashboard"), not a tab here: as a tab it sat inside whichever project was
// selected, which read as "this project's dashboard" (Antonio 2026-09-23).
const MAIN_BUTTONS: { id: MainTab; label: string; icon: LucideIcon }[] = [
  { id: "project", label: "Project", icon: FolderKanban },
  { id: "monitor", label: "Monitor", icon: BarChart3 },
];

const MAX_CHIP_DOTS = 8;

interface WorkspaceTabsProps {
  activeSection: WorkspaceSection;
  onSectionChange: (section: WorkspaceSection) => void;
}

export function WorkspaceTabs({ activeSection, onSectionChange }: WorkspaceTabsProps) {
  const { projectId } = useProjectContext();
  const activeMainTab = mainTabOf(activeSection);

  return (
    <div className="flex h-10 shrink-0 items-center border-b border-border bg-bg-secondary">
      {activeMainTab ? (
        <SectionRow
          mainTab={activeMainTab}
          activeSection={activeSection}
          onSectionChange={onSectionChange}
        />
      ) : (
        projectId && <WorkspaceTabBar />
      )}

      <div className="ml-auto flex h-full shrink-0 items-center gap-0.5 border-l border-border/40 px-1">
        {MAIN_BUTTONS.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            aria-pressed={activeMainTab === id}
            onClick={() => onSectionChange(toggleMainTab(id, activeSection))}
            className={cn(
              "flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors hover:bg-white/5 hover:text-text-primary",
              activeMainTab === id ? "bg-white/10 text-text-primary" : "text-text-muted",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SectionRow({
  mainTab,
  activeSection,
  onSectionChange,
}: {
  mainTab: MainTab;
  activeSection: WorkspaceSection;
  onSectionChange: (section: WorkspaceSection) => void;
}) {
  const activeGroup = groupOf(activeSection);
  const inner = activeGroup && activeGroup.sections.length > 1 ? activeGroup.sections : null;

  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1">
      <BackToTabs onClick={() => onSectionChange("agents")} />
      {SECTION_GROUPS[mainTab].map((group) => (
        <SectionButton
          key={group.label}
          label={group.label}
          active={group === activeGroup}
          onClick={() => onSectionChange(group.sections[0].id)}
        />
      ))}
      {inner && (
        <>
          <span className="mx-1.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
          {inner.map(({ id, label }) => (
            <SectionButton
              key={id}
              label={label}
              active={id === activeSection}
              compact
              onClick={() => onSectionChange(id)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function SectionButton({
  label,
  active,
  compact = false,
  onClick,
}: {
  label: string;
  active: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "relative flex h-8 shrink-0 items-center rounded px-2.5 font-medium whitespace-nowrap transition-colors hover:bg-white/5 hover:text-text-primary",
        compact ? "text-[11px]" : "text-xs",
        active ? (compact ? "text-accent" : "bg-white/10 text-text-primary") : "text-text-muted",
      )}
    >
      {label}
      {active && !compact && (
        <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" />
      )}
    </button>
  );
}

/** The way back to the layout tabs, with their status so a waiting session stays in sight */
function BackToTabs({ onClick }: { onClick: () => void }) {
  const tabs = useWorkspaceStore(selectTabs);
  const panes = useWorkspaceStore(selectPanes);
  // Only the dots: any session's status push otherwise re-renders this chip
  const dots = useAgentStore(
    useShallow((s) =>
      tabs
        .slice(0, MAX_CHIP_DOTS)
        .map((tab) =>
          tabDotClass(tabSignal(collectPaneIds(tab.layout), panes, s.agents, s.attentionItems)),
        ),
    ),
  );

  return (
    <button
      type="button"
      onClick={onClick}
      title="Back to tabs"
      className="mr-1 flex h-7 shrink-0 items-center gap-1 rounded border border-border/60 pr-2 pl-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
    >
      <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
      Tabs
      {dots.map((dot, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: one dot per tab position, nothing to keep
          key={i}
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot ?? "bg-text-muted/40")}
          aria-hidden="true"
        />
      ))}
      {tabs.length > MAX_CHIP_DOTS && (
        <span className="text-[10px] text-text-muted">+{tabs.length - MAX_CHIP_DOTS}</span>
      )}
    </button>
  );
}
