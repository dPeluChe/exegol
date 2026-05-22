import type { AgentCliType, AgentProvider } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import {
  findFirstPaneId,
  getFocusedOrFirstPaneId,
  getProjectState,
  useWorkspaceStore,
} from "../../stores/workspace";
import { AgentIcon } from "../common/AgentIcon";

export function QuickLaunchBar() {
  const { projectId } = useProjectContext();
  const [launching, setLaunching] = useState<string | null>(null);
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const addAgent = useAgentStore((s) => s.addAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const { data: providers } = useQuery({
    queryKey: ["enabledProviders"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listEnabledProviders"),
    staleTime: 30_000,
  });
  const cliAgents = providers ?? [];

  const handleLaunch = useCallback(
    async (cli: AgentProvider) => {
      if (!projectId || launching) return;
      setLaunching(cli.id);
      try {
        // biome-ignore lint/suspicious/noExplicitAny: tRPC dynamic shape
        const agent = await trpcMutate<any>("agents.spawn", {
          projectId,
          cliType: cli.id as AgentCliType,
          taskDescription: cli.name,
        });

        addAgent({
          id: agent.id,
          projectId,
          cliType: agent.cliType,
          status: agent.status,
          currentStep: agent.currentStep,
          taskDescription: agent.taskDescription,
          branchName: agent.branchName ?? null,
          tokenUsage: { input: 0, output: 0, cost: 0 },
          startedAt: agent.startedAt,
          accessMode: agent.accessMode ?? null,
          claudeSessionId: null,
          activityLevel: "busy",
        });
        createTerminal(agent.id);

        // Read fresh state to avoid stale closure
        const freshPw = getProjectState();
        const activeTab = freshPw.tabs.find((t) => t.id === freshPw.activeTabId);
        if (activeTab) {
          // T95: Prefer focused pane over first pane when targeting
          const targetPaneId = getFocusedOrFirstPaneId(activeTab);
          const targetPane = targetPaneId ? freshPw.panes[targetPaneId] : null;

          // Only replace empty panes or terminals with stopped/no agent
          // NEVER replace a pane with a running agent — that orphans the session
          const agentState = targetPane?.agentId
            ? useAgentStore.getState().agents[targetPane.agentId]
            : null;
          const isRunningAgent =
            agentState &&
            ["running", "spawning", "waiting_input", "paused"].includes(agentState.status);
          const canReplace =
            targetPane?.type === "empty" || (targetPane?.type === "terminal" && !isRunningAgent);

          if (canReplace && targetPaneId) {
            // Replace empty/stopped pane with new agent terminal
            updatePane(targetPaneId, {
              type: "terminal",
              agentId: agent.id,
            });
          } else {
            // Pane has a running agent or is browser/files/git: create a new tab
            const newTabId = addTab(cli.name);
            const newTab = getProjectState().tabs.find((t) => t.id === newTabId);
            if (newTab) {
              const newPaneId = findFirstPaneId(newTab.layout);
              if (newPaneId) {
                useWorkspaceStore.getState().updatePane(newPaneId, {
                  type: "terminal",
                  agentId: agent.id,
                });
              }
            }
          }
        } else {
          // No active tab: create one
          const newTabId = addTab(cli.name);
          const newTab = getProjectState().tabs.find((t) => t.id === newTabId);
          if (newTab) {
            const newPaneId = findFirstPaneId(newTab.layout);
            if (newPaneId) {
              useWorkspaceStore.getState().updatePane(newPaneId, {
                type: "terminal",
                agentId: agent.id,
              });
            }
          }
        }
      } catch (err) {
        console.error("[QuickLaunchBar] Spawn failed:", err);
      } finally {
        setLaunching(null);
      }
    },
    [projectId, launching, addAgent, createTerminal, updatePane, addTab],
  );

  return (
    <div className="flex h-7 items-center gap-1.5 overflow-x-auto px-2">
      {cliAgents.map((cli) => (
        <button
          type="button"
          key={cli.id}
          disabled={launching === cli.id}
          onClick={() => handleLaunch(cli)}
          className={cn(
            "group/cli relative flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-bold transition-all",
            "bg-zinc-700 text-zinc-400 hover:text-white",
            launching === cli.id && "opacity-40",
          )}
          style={{ "--cli-color": cli.color } as React.CSSProperties}
          title={cli.name}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = cli.color;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "";
          }}
        >
          <AgentIcon
            provider={cli.id}
            size={14}
            fallback={cli.icon}
            fallbackColor={cli.color}
            className="rounded-full"
          />
        </button>
      ))}
    </div>
  );
}
