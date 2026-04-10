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
import { useHotkeys } from "./hooks/use-hotkeys";
import { useTheme } from "./hooks/use-theme";
import { useToastEvents } from "./hooks/use-toast-events";
import { useAppStore } from "./stores/app";

// Lazy: rarely-used surfaces are not needed on first paint.
// ProjectList: only when there are no projects or user clicks "Add project".
// SettingsPanel: only when user opens settings (Radix dropdowns, form libs).
// CommandPalette: only opens on ⌘K.
const ProjectList = lazy(() =>
  import("./components/projects/ProjectList").then((m) => ({ default: m.ProjectList })),
);
const SettingsPanel = lazy(() =>
  import("./components/settings/SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
);
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette })),
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
    case "settings":
      return (
        <Suspense fallback={<LoadingSpinner className="h-full" />}>
          <SettingsPanel />
        </Suspense>
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
                  <Panel id="sidebar" order={1} defaultSize={20} minSize={15} maxSize={35}>
                    <Sidebar />
                  </Panel>
                  <PanelResizeHandle className="w-px bg-border hover:w-0.5 transition-all" />
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
      </div>
    </TooltipProvider>
  );
}
