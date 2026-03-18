import { Activity, Clock, Copy, FileText, LayoutGrid, Plus } from "lucide-react";
import { useCallback } from "react";
import { useAppVersion, usePrompts } from "../../hooks/use-trpc";
import { useAppStore } from "../../stores/app";
import { ResourcesOverview } from "./ResourcesOverview";
import { SchedulersOverview } from "./SchedulersOverview";
import { SidebarSection } from "./SidebarSection";

function PinnedPrompts() {
  const projectId = useAppStore((s) => s.activeProjectId);
  const { data: prompts } = usePrompts(projectId);
  const pinned = prompts?.filter((p) => p.pinned).slice(0, 3) ?? [];
  const totalCount = prompts?.length ?? 0;

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const navigateToPrompts = () => {
    if (projectId) {
      useAppStore.getState().setActiveView("workspace");
      window.dispatchEvent(
        new CustomEvent("exegol:switch-section", { detail: { section: "prompts" } }),
      );
    }
  };

  if (totalCount === 0) {
    return (
      <div className="space-y-1">
        <p className="text-[10px] italic text-text-muted">No prompts</p>
        {projectId && (
          <button
            type="button"
            onClick={navigateToPrompts}
            className="flex items-center gap-1 text-[10px] text-accent hover:text-accent-hover"
          >
            <Plus className="h-2.5 w-2.5" />
            Create prompt
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Summary line */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-text-muted">
          <span className="font-medium text-text-secondary">{totalCount}</span> prompt
          {totalCount !== 1 ? "s" : ""}
          {pinned.length > 0 && <span className="text-text-muted"> · {pinned.length} pinned</span>}
        </span>
        <button
          type="button"
          onClick={navigateToPrompts}
          className="text-text-muted hover:text-accent"
        >
          View →
        </button>
      </div>

      {/* Pinned prompts */}
      {pinned.map((p) => (
        <button
          type="button"
          key={p.id}
          onClick={() => handleCopy(p.content)}
          className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10px] text-text-muted transition-colors hover:bg-white/5"
          title={`Click to copy: ${p.title}`}
        >
          <Copy className="h-2.5 w-2.5 shrink-0" />
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
      <SidebarSection title="Schedulers" icon={Clock} defaultOpen={false}>
        <SchedulersOverview />
      </SidebarSection>

      <SidebarSection title="Prompts" icon={FileText} defaultOpen={false}>
        <PinnedPrompts />
      </SidebarSection>

      <SidebarSection title="Resources" icon={Activity} defaultOpen={false}>
        <ResourcesOverview />
      </SidebarSection>

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
