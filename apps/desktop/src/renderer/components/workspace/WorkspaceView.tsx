import { useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { AgentsSection } from "./sections/AgentsSection";
import { DiffSection } from "./sections/DiffSection";
import { ResourcesSection } from "./sections/ResourcesSection";
import { SchedulerSection } from "./sections/SchedulerSection";
import { TasksSection } from "./sections/TasksSection";
import { TokensSection } from "./sections/TokensSection";
import { type WorkspaceSection, WorkspaceTabs } from "./WorkspaceTabs";

export function WorkspaceView() {
  const { projectId } = useProjectContext();
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("agents");

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-primary">
        <p className="text-sm text-text-muted">Select a project to get started</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* Section tabs at top */}
      <WorkspaceTabs activeSection={activeSection} onSectionChange={setActiveSection} />

      {/* Section content */}
      <div className="flex-1 overflow-hidden">
        {activeSection === "agents" && <AgentsSection />}
        {activeSection === "tasks" && <TasksSection />}
        {activeSection === "diff" && <DiffSection />}
        {activeSection === "scheduler" && <SchedulerSection />}
        {activeSection === "tokens" && <TokensSection />}
        {activeSection === "resources" && <ResourcesSection />}
      </div>
    </div>
  );
}
