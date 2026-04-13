import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { dispatchRefitTerminals } from "../../lib/dispatch-refit";
import { LoadingSpinner } from "../common";
import { AgentsSection } from "./sections/AgentsSection";
import { type WorkspaceSection, WorkspaceTabs } from "./WorkspaceTabs";

// Lazy: non-default sections are only rendered on user demand.
// Each section bundles its own deps (PipelineSection pulls xterm via PipelineRunView).
const TasksSection = lazy(() =>
  import("./sections/TasksSection").then((m) => ({ default: m.TasksSection })),
);
const PromptsSkillsSection = lazy(() =>
  import("./sections/PromptsSkillsSection").then((m) => ({ default: m.PromptsSkillsSection })),
);
const MemorySection = lazy(() =>
  import("./sections/MemorySection").then((m) => ({ default: m.MemorySection })),
);
const PipelineSection = lazy(() =>
  import("./sections/PipelineSection").then((m) => ({ default: m.PipelineSection })),
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

function SectionFallback() {
  return <LoadingSpinner className="h-full" />;
}

export function WorkspaceView() {
  const { projectId } = useProjectContext();
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("agents");
  const isAgents = activeSection === "agents";
  const prevIsAgents = useRef(isAgents);

  // Listen for section switch events from sidebar (Rule 4: mount effect for event listener)
  useMountEffect(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent).detail?.section as WorkspaceSection;
      if (section) setActiveSection(section);
    };
    window.addEventListener("exegol:switch-section", handler);
    return () => window.removeEventListener("exegol:switch-section", handler);
  });

  // Force xterm.js terminals to re-fit when switching back to Agents tab
  useEffect(() => {
    if (isAgents && !prevIsAgents.current) {
      dispatchRefitTerminals();
    }
    prevIsAgents.current = isAgents;
  }, [isAgents]);

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-primary">
        <p className="text-sm text-text-muted">Select a project to get started</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      <WorkspaceTabs activeSection={activeSection} onSectionChange={setActiveSection} />

      <div className="relative flex-1 overflow-hidden">
        {/* Agents: always mounted. When hidden, keep in DOM but invisible.
            Dispatch resize event when becoming visible to trigger xterm.js fit() */}
        <div className={isAgents ? "absolute inset-0" : "invisible absolute inset-0"}>
          <AgentsSection />
        </div>

        {/* Other sections: conditionally rendered + lazy loaded (no terminal state to preserve) */}
        {activeSection !== "agents" && (
          <Suspense fallback={<SectionFallback />}>
            {activeSection === "tasks" && <TasksSection />}
            {activeSection === "prompts-skills" && <PromptsSkillsSection />}
            {activeSection === "memory" && <MemorySection />}
            {activeSection === "pipelines" && <PipelineSection />}
            {activeSection === "agent-dashboard" && <AgentDashboard />}
            {activeSection === "resources-tokens" && <ResourcesTokensSection />}
            {activeSection === "scoring" && <ScoringSection />}
          </Suspense>
        )}
      </div>
    </div>
  );
}
