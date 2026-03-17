import { Activity, Clock, Copy, FileText, LayoutGrid } from "lucide-react";
import { useCallback } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useAppVersion, usePrompts } from "../../hooks/use-trpc";
import { useAppStore } from "../../stores/app";
import { ResourcesOverview } from "./ResourcesOverview";
import { SchedulersOverview } from "./SchedulersOverview";
import { SidebarSection } from "./SidebarSection";

function PinnedPrompts() {
  const { projectId } = useProjectContext();
  const { data: prompts } = usePrompts(projectId);
  const pinned = prompts?.filter((p) => p.pinned).slice(0, 3) ?? [];

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  if (pinned.length === 0) {
    return <p className="text-[10px] text-text-muted">No pinned prompts</p>;
  }

  return (
    <div className="space-y-1">
      {pinned.map((p) => (
        <button
          type="button"
          key={p.id}
          onClick={() => handleCopy(p.content)}
          className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] text-text-secondary transition-colors hover:bg-white/5"
          title={`Click to copy: ${p.title}`}
        >
          <Copy className="h-2.5 w-2.5 shrink-0 text-text-muted" />
          <span className="truncate">{p.title}</span>
        </button>
      ))}
    </div>
  );
}

export function SidebarFooter() {
  const { data: appVersion } = useAppVersion();

  return (
    <div className="flex flex-col">
      {/* Schedulers, Prompts & Resources — compact, collapsible */}
      <SidebarSection title="Schedulers" icon={Clock} defaultOpen={false}>
        <SchedulersOverview />
      </SidebarSection>

      <SidebarSection title="Prompts" icon={FileText} defaultOpen={false}>
        <PinnedPrompts />
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
