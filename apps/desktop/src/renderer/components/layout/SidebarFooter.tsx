import { Activity, History, LayoutGrid } from "lucide-react";
import { useAppVersion } from "../../hooks/use-trpc";
import { useAppStore } from "../../stores/app";
import { ActivityFeed } from "./ActivityFeed";
import { RecentSessions } from "./RecentSessions";
import { ResourcesOverview } from "./ResourcesOverview";
import { SidebarSection } from "./SidebarSection";

export function SidebarFooter() {
  const { data: appVersion } = useAppVersion();

  return (
    <div className="flex flex-col">
      <SidebarSection title="Recent Sessions" icon={History} defaultOpen={false}>
        <RecentSessions />
      </SidebarSection>

      <SidebarSection title="Activity" icon={Activity} defaultOpen={false}>
        <div className="space-y-2">
          <ResourcesOverview />
          <ActivityFeed />
        </div>
      </SidebarSection>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <button
          type="button"
          onClick={() => useAppStore.getState().openProjects()}
          className="flex items-center gap-1.5 text-[11px] text-text-muted transition-colors hover:text-text-secondary"
        >
          <LayoutGrid className="h-3 w-3" />
          All Projects
        </button>
        {appVersion && <span className="text-[10px] text-text-muted">v{appVersion}</span>}
      </div>
    </div>
  );
}
