import type { WorkspaceSection } from "../components/workspace/WorkspaceTabs";

export const SWITCH_SECTION_EVENT = "exegol:switch-section";

// Typed so a section name that doesn't exist fails to compile instead of blanking the workspace
export function switchSection(section: WorkspaceSection): void {
  window.dispatchEvent(new CustomEvent(SWITCH_SECTION_EVENT, { detail: { section } }));
}
