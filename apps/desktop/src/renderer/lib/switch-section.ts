import type { WorkspaceSection } from "../components/workspace/WorkspaceTabs";
import { useAppStore } from "../stores/app";

export const SWITCH_SECTION_EVENT = "exegol:switch-section";

// Typed so a section name that doesn't exist fails to compile instead of blanking the workspace
export function switchSection(section: WorkspaceSection): void {
  // A section belongs to a project: asking for one leaves the dashboard
  const app = useAppStore.getState();
  if (app.activeView === "dashboard" && app.activeProjectId) app.setActiveView("workspace");
  window.dispatchEvent(new CustomEvent(SWITCH_SECTION_EVENT, { detail: { section } }));
}
