import type { AgentCliType, AgentProvider } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { Cpu, FolderTree, GitBranch, Globe, Terminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { type PortInfo, useProjectScripts } from "../../hooks/use-trpc-scheduler";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useTerminalStore } from "../../stores/terminals";
import { useWorkspaceStore } from "../../stores/workspace";
import { AgentIcon } from "../common";

// ─── Empty Pane (Agent Grid) ────────────────────────────────────────────────

export function EmptyPane({ paneId }: { paneId: string }) {
  const { projectId, project } = useProjectContext();
  const { data: scripts } = useProjectScripts(project?.path ?? null);
  const [launching, setLaunching] = useState<string | null>(null);
  const addAgent = useAgentStore((s) => s.addAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<"full" | "compact" | "mini">("full");
  const { data: providers } = useQuery({
    queryKey: ["enabledProviders"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listEnabledProviders"),
    staleTime: 30_000,
  });
  const cliOptions = providers ?? [];

  // Observe pane size for responsive layout
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      if (w < 300 || h < 250) setSize("mini");
      else if (w < 500 || h < 400) setSize("compact");
      else setSize("full");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleLaunchAgent = useCallback(
    async (cli: AgentProvider) => {
      if (!projectId) return;
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
        });
        createTerminal(agent.id);

        // Convert this empty pane to a terminal pane
        updatePane(paneId, { type: "terminal", agentId: agent.id });
      } catch (err) {
        console.error("[EmptyPane] Spawn failed:", err);
      } finally {
        setLaunching(null);
      }
    },
    [projectId, paneId, addAgent, createTerminal, updatePane],
  );

  const handleBrowser = useCallback(async () => {
    let url = "http://localhost:3000";
    try {
      if (projectId) {
        const preferred = await trpcInvoke<number | null>("resources.preferredPort", { projectId });
        if (preferred) {
          url = `http://localhost:${preferred}`;
        } else if (project?.path) {
          const ports = await trpcInvoke<PortInfo[]>("resources.ports", {
            projectPath: project.path,
          });
          const runtime = ports?.find((p) => p.source === "runtime");
          const first = runtime ?? ports?.[0];
          if (first) url = `http://localhost:${first.port}`;
        }
      }
    } catch {
      /* fallback to default */
    }
    updatePane(paneId, { type: "browser", url });
  }, [paneId, projectId, project?.path, updatePane]);

  const handleFiles = useCallback(() => {
    updatePane(paneId, { type: "files" });
  }, [paneId, updatePane]);

  const handleGit = useCallback(() => {
    updatePane(paneId, { type: "git" });
  }, [paneId, updatePane]);

  const handleShell = useCallback(async () => {
    if (!projectId) return;
    setLaunching("shell");
    try {
      // biome-ignore lint/suspicious/noExplicitAny: tRPC dynamic shape
      const agent = await trpcMutate<any>("agents.spawn", {
        projectId,
        cliType: "shell",
        taskDescription: "Terminal",
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
      });
      createTerminal(agent.id);
      updatePane(paneId, { type: "terminal", agentId: agent.id });
    } catch (err) {
      console.error("[EmptyPane] Shell spawn failed:", err);
    } finally {
      setLaunching(null);
    }
  }, [projectId, paneId, addAgent, createTerminal, updatePane]);

  const handleRunScript = useCallback(
    async (command: string, label: string) => {
      if (!projectId) return;
      setLaunching(`script-${label}`);
      try {
        // biome-ignore lint/suspicious/noExplicitAny: tRPC dynamic shape
        const agent = await trpcMutate<any>("agents.spawn", {
          projectId,
          cliType: "shell",
          taskDescription: label,
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
        });
        createTerminal(agent.id);
        updatePane(paneId, { type: "terminal", agentId: agent.id });
        // Inject command into shell (queued until PTY is ready)
        window.api.terminal.write(agent.id, `${command}\n`);
      } catch (err) {
        console.error("[EmptyPane] Script launch failed:", err);
      } finally {
        setLaunching(null);
      }
    },
    [projectId, paneId, addAgent, createTerminal, updatePane],
  );

  const isMini = size === "mini";
  const isCompact = size === "compact" || isMini;
  const iconSize = isMini ? 18 : isCompact ? 22 : 28;
  const gridCols = isMini ? "grid-cols-4" : isCompact ? "grid-cols-4" : "grid-cols-4";

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col items-center justify-center overflow-y-auto p-3"
    >
      {/* Header — hidden in mini */}
      {!isMini && (
        <div className="mb-3 flex shrink-0 flex-col items-center gap-2">
          <div
            className={cn(
              "flex items-center justify-center rounded-2xl bg-bg-secondary",
              isCompact ? "h-9 w-9" : "h-12 w-12",
            )}
          >
            <Cpu className={cn("text-text-muted", isCompact ? "h-4 w-4" : "h-6 w-6")} />
          </div>
          <div className="text-center">
            <h2
              className={cn("font-semibold text-text-primary", isCompact ? "text-xs" : "text-sm")}
            >
              Launch an Agent
            </h2>
            {!isCompact && (
              <p className="mt-0.5 text-[11px] text-text-muted">Select an agent or open a pane.</p>
            )}
          </div>
        </div>
      )}

      {/* Agent grid — responsive columns and sizes */}
      <div className={cn("grid w-full gap-1.5", gridCols, isMini ? "max-w-xs" : "max-w-sm")}>
        {cliOptions.map((cli) => (
          <button
            key={cli.id}
            type="button"
            disabled={launching === cli.id}
            onClick={() => handleLaunchAgent(cli)}
            className={cn(
              "flex flex-col items-center rounded-lg border border-border bg-bg-secondary transition-all hover:border-accent/50 hover:bg-white/[0.03]",
              isMini ? "gap-0.5 p-1.5" : isCompact ? "gap-1 p-2" : "gap-1.5 p-2.5",
              launching === cli.id && "opacity-50",
            )}
          >
            <AgentIcon
              provider={cli.id}
              size={iconSize}
              fallback={cli.icon}
              fallbackColor={cli.color}
            />
            {!isMini && (
              <span
                className={cn(
                  "font-medium text-text-secondary",
                  isCompact ? "text-[8px]" : "text-[9px]",
                )}
              >
                {cli.name}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Dev scripts quick-launch */}
      {scripts && scripts.length > 0 && (
        <div className={cn("flex w-full flex-col items-center", isMini ? "mt-1.5" : "mt-3")}>
          {!isMini && <span className="mb-1 text-[9px] text-text-muted">Dev Scripts</span>}
          <div className="flex flex-wrap justify-center gap-1">
            {scripts.map((s) => (
              <button
                key={s.command}
                type="button"
                disabled={launching === `script-${s.name}`}
                onClick={() => handleRunScript(s.command, s.name)}
                className={cn(
                  "flex items-center gap-1 rounded-lg border border-border bg-bg-secondary text-text-secondary transition-all hover:border-accent/50 hover:bg-white/[0.03]",
                  isMini ? "px-2 py-1 text-[9px]" : "px-3 py-1.5 text-[11px]",
                  launching === `script-${s.name}` && "opacity-50",
                )}
              >
                <Terminal className={cn(isMini ? "h-3 w-3" : "h-3.5 w-3.5")} />
                {s.name}
                {!isMini && s.framework && (
                  <span className="text-[9px] text-text-muted">({s.framework})</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pane options — compact in small sizes */}
      <div className={cn("flex shrink-0 items-center", isMini ? "mt-1.5 gap-1" : "mt-3 gap-2")}>
        {[
          { handler: handleShell, icon: Terminal, label: "Terminal" },
          { handler: handleBrowser, icon: Globe, label: "Browser" },
          { handler: handleFiles, icon: FolderTree, label: "Files" },
          { handler: handleGit, icon: GitBranch, label: "Git" },
        ].map(({ handler, icon: PaneIcon, label }) => (
          <button
            key={label}
            type="button"
            onClick={handler}
            className={cn(
              "flex items-center gap-1 rounded-lg border border-border bg-bg-secondary text-text-secondary transition-all hover:border-accent/50 hover:bg-white/[0.03]",
              isMini ? "px-2 py-1 text-[9px]" : "px-3 py-1.5 text-[11px]",
            )}
          >
            <PaneIcon className={cn(isMini ? "h-3 w-3" : "h-3.5 w-3.5")} />
            {!isMini && label}
          </button>
        ))}
      </div>
    </div>
  );
}
