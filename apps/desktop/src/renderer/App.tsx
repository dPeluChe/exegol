import { TooltipProvider } from "@exegol/ui";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { TitleBar } from "./components/layout/TitleBar";
import { ProjectList } from "./components/projects/ProjectList";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { WorkspaceView } from "./components/workspace/WorkspaceView";
import { ProjectProvider } from "./contexts/ProjectContext";
import { useHotkeys } from "./hooks/use-hotkeys";
import { useTheme } from "./hooks/use-theme";
import { useAppStore } from "./stores/app";

function MainContent() {
  const activeView = useAppStore((s) => s.activeView);

  switch (activeView) {
    case "projects":
      return <ProjectList />;
    case "workspace":
      return (
        <ProjectProvider>
          <WorkspaceView />
        </ProjectProvider>
      );
    case "settings":
      return <SettingsPanel />;
    default:
      return <ProjectList />;
  }
}

export default function App() {
  const activeView = useAppStore((s) => s.activeView);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);

  useHotkeys();
  useTheme();

  const showSidebar = activeView === "workspace";

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen flex-col bg-bg-primary">
        <TitleBar />

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
      </div>
    </TooltipProvider>
  );
}
