import { Button } from "@exegol/ui";
import { Cpu, FolderTree, Rocket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useAgentStore } from "../../../stores/agents";
import { SpawnAgentDialog } from "../../agents/SpawnAgentDialog";
import { TerminalSplitView } from "../../terminal/TerminalSplitView";
import { TerminalTabs } from "../../terminal/TerminalTabs";
import { FileExplorer } from "../FileExplorer";

export function AgentsSection() {
  const { project, projectId, agents } = useProjectContext();
  const focusedAgentId = useAgentStore((s) => s.focusedAgentId);
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const toggleFiles = useCallback(() => setShowFiles((prev) => !prev), []);

  useEffect(() => {
    const handler = () => setSpawnDialogOpen(true);
    window.addEventListener("exegol:spawn-agent", handler);
    return () => window.removeEventListener("exegol:spawn-agent", handler);
  }, []);

  const hasAgents = agents.length > 0;

  if (!projectId) return null;

  return (
    <div className="flex h-full flex-col">
      {hasAgents ? (
        <>
          {/* Tab bar */}
          <TerminalTabs
            onSpawnClick={() => setSpawnDialogOpen(true)}
            extraActions={
              <button
                type="button"
                onClick={toggleFiles}
                className={`flex h-7 items-center gap-1 rounded px-2 text-[11px] transition-colors ${showFiles ? "bg-white/10 text-text-primary" : "text-text-muted hover:bg-white/5"}`}
                title="Toggle file explorer"
              >
                <FolderTree className="h-3 w-3" />
                Files
              </button>
            }
          />

          {/* Resizable panel layout */}
          <PanelGroup direction="horizontal" autoSaveId="workspace-panels">
            {/* Main terminal panel - always visible */}
            <Panel id="terminal" order={1} defaultSize={showFiles ? 60 : 100}>
              {focusedAgentId ? (
                <TerminalSplitView key={focusedAgentId} agentId={focusedAgentId} />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-text-muted">
                    Select an agent tab to view its terminal
                  </p>
                </div>
              )}
            </Panel>

            {/* File explorer panel */}
            {showFiles && project && (
              <>
                <PanelResizeHandle className="w-px hover:w-0.5 transition-all bg-border" />
                <Panel id="file-explorer" order={2} defaultSize={40} minSize={20}>
                  <FileExplorer rootPath={project.path} />
                </Panel>
              </>
            )}
          </PanelGroup>
        </>
      ) : (
        /* Empty state */
        <div className="flex h-full flex-col items-center justify-center gap-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-bg-secondary">
            <Cpu className="h-10 w-10 text-text-muted" />
          </div>
          <div className="text-center">
            <h2 className="text-base font-semibold text-text-primary">No agents running</h2>
            <p className="mt-1 max-w-sm text-xs text-text-muted">
              Launch your first agent to start working. Each agent runs in its own terminal with an
              isolated git worktree.
            </p>
          </div>
          <Button onClick={() => setSpawnDialogOpen(true)} className="gap-2 bg-accent text-white">
            <Rocket className="h-4 w-4" />
            Launch Your First Agent
          </Button>
        </div>
      )}

      {/* Spawn dialog */}
      <SpawnAgentDialog
        open={spawnDialogOpen}
        onOpenChange={setSpawnDialogOpen}
        projectId={projectId}
      />
    </div>
  );
}
