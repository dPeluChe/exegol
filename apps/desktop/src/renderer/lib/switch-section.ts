import type { WorkspaceSection } from "../components/workspace/WorkspaceTabs";
import { useAppStore } from "../stores/app";

// Typed so a section name that doesn't exist fails to compile instead of blanking the workspace
export function switchSection(section: WorkspaceSection): void {
  // A section belongs to a project: asking for one leaves the dashboard
  const app = useAppStore.getState();
  if (app.activeView === "dashboard" && app.activeProjectId) app.setActiveView("workspace");
  app.setWorkspaceSection(section);
}
