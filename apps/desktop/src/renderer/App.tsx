import { TooltipProvider } from "@exegol/ui";
import { lazy, Suspense } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { LoadingSpinner } from "./components/common";
import { CloseConfirmHost } from "./components/common/CloseConfirmHost";
import { SidecarHealthBanner } from "./components/common/SidecarHealthBanner";
import { ToastStack } from "./components/common/ToastStack";
import { UpdateBanner } from "./components/common/UpdateBanner";
import { DictationOverlay } from "./components/dictation/DictationOverlay";
import { CliUpdatesNotice } from "./components/layout/CliUpdatesNotice";
import { WhatsNewAfterUpdate } from "./components/layout/ReleaseNotesDialog";
import { Sidebar } from "./components/layout/Sidebar";
import { SidebarRail } from "./components/layout/SidebarRail";
import { StatusBar } from "./components/layout/StatusBar";
import { TitleBar } from "./components/layout/TitleBar";
import { PaneSwitcher } from "./components/workspace/PaneSwitcher";
import { WorkspaceView } from "./components/workspace/WorkspaceView";
import { ProjectProvider } from "./contexts/ProjectContext";
import { useActiveViewSync } from "./hooks/use-active-view-sync";
import { useAutoSelectProject } from "./hooks/use-auto-select-project";
import { useCliRestarts } from "./hooks/use-cli-updates";
import { useDeepLink } from "./hooks/use-deeplink";
import { useDictation } from "./hooks/use-dictation";
import { useFleetSync } from "./hooks/use-fleet-sync";
import { useFloatingPaneSync } from "./hooks/use-floating-pane-sync";
import { useHotkeys } from "./hooks/use-hotkeys";
import { usePanelessAgentSweep } from "./hooks/use-paneless-agent-sweep";
import { useAutoResumeLost, useRelaunchMissedResume } from "./hooks/use-resume-agent";
import { useSettingsSync } from "./hooks/use-settings-sync";
import { useTheme } from "./hooks/use-theme";
import { useToastEvents } from "./hooks/use-toast-events";
import { useUpdateStatusSync } from "./hooks/use-update-status";
import { useAppStore } from "./stores/app";

// Lazy: rarely-used surfaces are not needed on first paint.
// ProjectList: only when there are no projects or user clicks "Add project".
// CommandPalette: only opens on ⌘K.
// Settings live in their own BrowserWindow (T120) — not lazy-loaded here.
const ProjectList = lazy(() =>
  import("./components/projects/ProjectList").then((m) => ({ default: m.ProjectList })),
);
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
// WelcomeTour: once after onboarding, or when reopened from the command palette.
const WelcomeTour = lazy(() =>
  import("./components/onboarding/WelcomeTour").then((m) => ({ default: m.WelcomeTour })),
);
// OnboardingWizard: only rendered for first-run users with zero projects (T148).
const OnboardingWizard = lazy(() =>
  import("./components/onboarding/OnboardingWizard").then((m) => ({
    default: m.OnboardingWizard,
  })),
);

export default function App() {
  const activeView = useAppStore((s) => s.activeView);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);

  useHotkeys();
  useDictation();
  useToastEvents();
  useTheme();
  useAutoSelectProject();
  useDeepLink();
  useFloatingPaneSync();
  usePanelessAgentSweep();
  useSettingsSync();
  useUpdateStatusSync();
  useAutoResumeLost();
  useRelaunchMissedResume();
  useCliRestarts();
  useFleetSync();
  useActiveViewSync();

  const activeProjectId = useAppStore((s) => s.activeProjectId);
  // Projects opens over the workspace (as the Dashboard does): its panes stay mounted and sized
  const showWorkspace = activeView !== "projects" || activeProjectId !== null;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen flex-col bg-bg-primary">
        <TitleBar />
        <WhatsNewAfterUpdate />
        <CliUpdatesNotice />
        <CloseConfirmHost />
        <UpdateBanner />
        <SidecarHealthBanner />

        <div className="relative flex-1 overflow-hidden">
          {showWorkspace && (
            <div className="flex h-full">
              {/* Collapsed = icon rail, not gone */}
              {sidebarCollapsed && <SidebarRail />}
              <PanelGroup
                direction="horizontal"
                autoSaveId="exegol-layout"
                className="min-w-0 flex-1"
              >
                {!sidebarCollapsed && (
                  <>
                    <Panel id="sidebar" order={1} defaultSize={20} minSize={10} maxSize={40}>
                      <Sidebar />
                    </Panel>
                    <PanelResizeHandle className="group relative w-1.5 shrink-0">
                      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-[width,background-color] group-hover:w-[3px] group-hover:bg-accent/60 group-data-[resize-handle-active]:w-[3px] group-data-[resize-handle-active]:bg-accent" />
                    </PanelResizeHandle>
                  </>
                )}
                <Panel id="main" order={2} defaultSize={80}>
                  {/* Same element for workspace and dashboard: switching keeps every pane mounted */}
                  <ProjectProvider>
                    <WorkspaceView />
                  </ProjectProvider>
                </Panel>
              </PanelGroup>
            </div>
          )}
          {activeView === "projects" && (
            <div className={showWorkspace ? "absolute inset-0 z-20 bg-bg-primary" : "h-full"}>
              <Suspense fallback={<LoadingSpinner className="h-full" />}>
                <ProjectList />
              </Suspense>
            </div>
          )}
        </div>

        <StatusBar />
        <ToastStack />
        <PaneSwitcher />
        <DictationOverlay />
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
        <Suspense fallback={null}>
          <OnboardingWizard />
        </Suspense>
        <Suspense fallback={null}>
          <WelcomeTour />
        </Suspense>
      </div>
    </TooltipProvider>
  );
}
