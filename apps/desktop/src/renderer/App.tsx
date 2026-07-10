import { TooltipProvider } from "@exegol/ui";
import { lazy, Suspense } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { LoadingSpinner } from "./components/common";
import { ToastStack } from "./components/common/ToastStack";
import { UpdateBanner } from "./components/common/UpdateBanner";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { TitleBar } from "./components/layout/TitleBar";
import { WorkspaceView } from "./components/workspace/WorkspaceView";
import { ProjectProvider } from "./contexts/ProjectContext";
import { useAutoSelectProject } from "./hooks/use-auto-select-project";
import { useDeepLink } from "./hooks/use-deeplink";
import { useFloatingPaneSync } from "./hooks/use-floating-pane-sync";
import { useHotkeys } from "./hooks/use-hotkeys";
import { useSettingsSync } from "./hooks/use-settings-sync";
import { useTheme } from "./hooks/use-theme";
import { useToastEvents } from "./hooks/use-toast-events";
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
// OnboardingWizard: only rendered for first-run users with zero projects (T148).
const OnboardingWizard = lazy(() =>
  import("./components/onboarding/OnboardingWizard").then((m) => ({
    default: m.OnboardingWizard,
  })),
);

function MainContent() {
  const activeView = useAppStore((s) => s.activeView);

  switch (activeView) {
    case "projects":
      return (
        <Suspense fallback={<LoadingSpinner className="h-full" />}>
          <ProjectList />
        </Suspense>
      );
    case "workspace":
      return (
        <ProjectProvider>
          <WorkspaceView />
        </ProjectProvider>
      );
    default:
      return (
        <Suspense fallback={<LoadingSpinner className="h-full" />}>
          <ProjectList />
        </Suspense>
      );
  }
}

export default function App() {
  const activeView = useAppStore((s) => s.activeView);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);

  useHotkeys();
  useToastEvents();
  useTheme();
  useAutoSelectProject();
  useDeepLink();
  useFloatingPaneSync();
  useSettingsSync();

  const showSidebar = activeView === "workspace";

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen flex-col bg-bg-primary">
        <TitleBar />
        <UpdateBanner />

        <div className="flex-1 overflow-hidden">
          {showSidebar ? (
            <PanelGroup direction="horizontal" autoSaveId="exegol-layout">
              {!sidebarCollapsed && (
                <>
                  <Panel id="sidebar" order={1} defaultSize={20} minSize={10} maxSize={40}>
                    <Sidebar />
                  </Panel>
                  <PanelResizeHandle className="group relative w-1.5 shrink-0">
                    <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-all group-hover:w-[3px] group-hover:bg-accent/60 group-data-[resize-handle-active]:w-[3px] group-data-[resize-handle-active]:bg-accent" />
                  </PanelResizeHandle>
                </>
              )}
              <Panel id="main" order={2} defaultSize={80}>
                <MainContent />
              </Panel>
            </PanelGroup>
          ) : (
            <MainContent />
          )}
        </div>

        <StatusBar />
        <ToastStack />
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
        <Suspense fallback={null}>
          <OnboardingWizard />
        </Suspense>
      </div>
    </TooltipProvider>
  );
}
