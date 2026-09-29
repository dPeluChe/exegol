import React, { lazy, Suspense } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { SHORTCUTS } from "../../lib/shortcuts";
import { useAppStore } from "../../stores/app";
import { ParallelSpawnModal } from "../agents/ParallelSpawnModal";
import { SpawnAgentModal } from "../agents/SpawnAgentModal";
import { LoadingSpinner } from "../common";
import { AgentsSection } from "./sections/AgentsSection";
import {
  useActiveSection,
  useAgentNavigationEvents,
  useRefitOnAgentsShown,
  useShortcutsOverlay,
  useSpawnModalEvents,
} from "./use-workspace-events";
import { type WorkspaceSection, WorkspaceTabs } from "./WorkspaceTabs";

// ─── Shortcuts for the help overlay (Cmd+/) ────────────────────────────────

// Lazy: non-default sections are only rendered on user demand.
// Each section bundles its own deps (PipelineSection pulls xterm via PipelineRunView).
const HistorySection = lazy(() =>
  import("./sections/HistorySection").then((m) => ({ default: m.HistorySection })),
);
const TasksSection = lazy(() =>
  import("./sections/TasksSection").then((m) => ({ default: m.TasksSection })),
);
const PromptsSkillsSection = lazy(() =>
  import("./sections/PromptsSkillsSection").then((m) => ({ default: m.PromptsSkillsSection })),
);
const MemorySection = lazy(() =>
  import("./sections/MemorySection").then((m) => ({ default: m.MemorySection })),
);
const KnowledgeSection = lazy(() =>
  import("./sections/KnowledgeSection").then((m) => ({ default: m.KnowledgeSection })),
);
const PipelineSection = lazy(() =>
  import("./sections/PipelineSection").then((m) => ({ default: m.PipelineSection })),
);
const ParallelRunsSection = lazy(() =>
  import("./sections/ParallelRunsSection").then((m) => ({ default: m.ParallelRunsSection })),
);
const ResourcesTokensSection = lazy(() =>
  import("./sections/ResourcesTokensSection").then((m) => ({ default: m.ResourcesTokensSection })),
);
const ScoringSection = lazy(() =>
  import("./sections/ScoringSection").then((m) => ({ default: m.ScoringSection })),
);
const AgentDashboard = lazy(() =>
  import("./sections/AgentDashboard").then((m) => ({ default: m.AgentDashboard })),
);
const QaTestsSection = lazy(() =>
  import("./sections/QaTestsSection").then((m) => ({ default: m.QaTestsSection })),
);

/** Non-Agents sections: conditionally rendered + lazy loaded (no terminal state to preserve) */
const LAZY_SECTIONS: Record<Exclude<WorkspaceSection, "agents">, React.ComponentType> = {
  tasks: TasksSection,
  history: HistorySection,
  "prompts-skills": PromptsSkillsSection,
  memory: MemorySection,
  knowledge: KnowledgeSection,
  pipelines: PipelineSection,
  "parallel-runs": ParallelRunsSection,
  "qa-tests": QaTestsSection,
  "resources-tokens": ResourcesTokensSection,
  scoring: ScoringSection,
};

function SectionFallback() {
  return <LoadingSpinner className="h-full" />;
}

export function WorkspaceView() {
  const { projectId } = useProjectContext();
  // Home = the fleet dashboard (Antonio 2026-08-11): land on the cross-project
  // control center; the Agents tab stays mounted underneath for its terminals.
  const onDashboard = useAppStore((s) => s.activeView === "dashboard");
  const [activeSection, setActiveSection] = useActiveSection(onDashboard);
  const spawn = useSpawnModalEvents();
  const { showShortcuts, closeShortcuts } = useShortcutsOverlay();
  useAgentNavigationEvents();
  const isAgents = activeSection === "agents" && !onDashboard;
  useRefitOnAgentsShown(isAgents);

  if (!projectId && !onDashboard) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-primary">
        <p className="text-sm text-text-muted">Select a project to get started</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-bg-primary">
      {/* Tabs stay laid out under the dashboard: hiding them made the panes
          behind it taller, so every dashboard toggle resized every PTY twice */}
      <WorkspaceTabs activeSection={activeSection} onSectionChange={setActiveSection} />

      <SectionArea
        projectId={projectId}
        activeSection={activeSection}
        isAgents={isAgents}
        onDashboard={onDashboard}
      />

      {onDashboard && (
        <Suspense fallback={<SectionFallback />}>
          <div className="absolute inset-0 z-10 bg-bg-primary">
            <AgentDashboard />
          </div>
        </Suspense>
      )}

      {projectId && <SpawnModals projectId={projectId} spawn={spawn} />}

      {showShortcuts && <ShortcutsOverlay onClose={closeShortcuts} />}
    </div>
  );
}

function SectionArea({
  projectId,
  activeSection,
  isAgents,
  onDashboard,
}: {
  projectId: string | null;
  activeSection: WorkspaceSection;
  isAgents: boolean;
  onDashboard: boolean;
}) {
  const LazySection = activeSection === "agents" ? null : LAZY_SECTIONS[activeSection];
  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Agents: always mounted. When hidden, keep in DOM but invisible.
          Dispatch resize event when becoming visible to trigger xterm.js fit() */}
      {projectId && (
        <div className={isAgents ? "absolute inset-0" : "invisible absolute inset-0"}>
          <AgentsSection />
        </div>
      )}

      {/* Keyed by project: local state (task file, unsaved brief, open pipeline run) leaked
          into the next project, and a Save wrote A's brief into B */}
      {!onDashboard && LazySection && (
        <Suspense key={projectId ?? "none"} fallback={<SectionFallback />}>
          <LazySection />
        </Suspense>
      )}
    </div>
  );
}

function SpawnModals({
  projectId,
  spawn,
}: {
  projectId: string;
  spawn: ReturnType<typeof useSpawnModalEvents>;
}) {
  return (
    <>
      {spawn.showSpawnModal && (
        <SpawnAgentModal
          projectId={projectId}
          initialTask={spawn.spawnInitialTask}
          initialCliType={spawn.spawnInitialCliType}
          onClose={spawn.closeSpawnModal}
        />
      )}
      {spawn.showParallelModal && (
        <ParallelSpawnModal projectId={projectId} onClose={spawn.closeParallelModal} />
      )}
    </>
  );
}

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} role="none" />
      <div className="relative z-10 w-[400px] rounded-xl border border-border bg-bg-primary p-4 shadow-2xl">
        <h2 className="mb-3 text-sm font-semibold text-text-primary">Keyboard Shortcuts</h2>
        <div className="grid grid-cols-2 gap-y-1.5 text-[11px]">
          {SHORTCUTS.map((s) => ({ key: s.keys, label: s.label })).map((s) => (
            <React.Fragment key={s.key}>
              <span className="text-text-muted">{s.label}</span>
              <kbd className="text-right font-mono text-text-secondary">{s.key}</kbd>
            </React.Fragment>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-lg bg-bg-secondary py-1.5 text-[11px] text-text-muted hover:bg-white/5"
        >
          Close
        </button>
      </div>
    </div>
  );
}
