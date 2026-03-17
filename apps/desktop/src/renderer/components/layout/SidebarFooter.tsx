import { Activity, Clock, LayoutGrid } from "lucide-react";
import { useAppVersion } from "../../hooks/use-trpc";
import { useAppStore } from "../../stores/app";
import { ResourcesOverview } from "./ResourcesOverview";
import { SchedulersOverview } from "./SchedulersOverview";
import { SidebarSection } from "./SidebarSection";

export function SidebarFooter() {
  const { data: appVersion } = useAppVersion();

  return (
    <div className="flex flex-col">
      {/* Schedulers & Resources — compact, collapsible */}
      <SidebarSection title="Schedulers" icon={Clock} defaultOpen={false}>
        <SchedulersOverview />
      </SidebarSection>

      <SidebarSection title="Resources" icon={Activity} defaultOpen={false}>
        <ResourcesOverview />
      </SidebarSection>

      {/* Bottom bar */}
      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <button
          type="button"
          onClick={() => useAppStore.getState().setActiveProject(null)}
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
