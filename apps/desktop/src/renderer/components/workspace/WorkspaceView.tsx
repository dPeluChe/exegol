import { useEffect, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { AgentsSection } from "./sections/AgentsSection";
import { MemorySection } from "./sections/MemorySection";
import { PromptsSkillsSection } from "./sections/PromptsSkillsSection";
import { ResourcesTokensSection } from "./sections/ResourcesTokensSection";
import { ScoringSection } from "./sections/ScoringSection";
import { TasksSection } from "./sections/TasksSection";
import { type WorkspaceSection, WorkspaceTabs } from "./WorkspaceTabs";

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
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("exegol:refit-terminals"));
      });
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

        {/* Other sections: conditionally rendered (no terminal state to preserve) */}
        {activeSection === "tasks" && <TasksSection />}
        {activeSection === "prompts-skills" && <PromptsSkillsSection />}
        {activeSection === "memory" && <MemorySection />}
        {activeSection === "resources-tokens" && <ResourcesTokensSection />}
        {activeSection === "scoring" && <ScoringSection />}
      </div>
    </div>
  );
}
