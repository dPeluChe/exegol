import type { AgentCliType } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { useTerminalStore } from "../../stores/terminals";

// ─── CLI Agent Definitions ──────────────────────────────────────────────────

interface CliAgent {
  type: AgentCliType;
  name: string;
  short: string;
  color: string;
}

const CLI_AGENTS: CliAgent[] = [
  { type: "claude-code", name: "Claude Code", short: "C", color: "#D97706" },
  { type: "codex", name: "Codex", short: "Co", color: "#10B981" },
  { type: "gemini", name: "Gemini", short: "G", color: "#3B82F6" },
  { type: "aider", name: "Aider", short: "A", color: "#8B5CF6" },
  { type: "opencode", name: "OpenCode", short: "OC", color: "#EC4899" },
  { type: "goose", name: "Goose", short: "Go", color: "#F97316" },
  { type: "amp", name: "Amp", short: "Am", color: "#06B6D4" },
  { type: "kiro", name: "Kiro", short: "K", color: "#84CC16" },
];

// ─── Agent Launcher ─────────────────────────────────────────────────────────

interface AgentLauncherProps {
  projectId: string;
}

export function AgentLauncher({ projectId }: AgentLauncherProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [launching, setLaunching] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const addAgent = useAgentStore((s) => s.addAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);

  const handleLaunch = useCallback(
    async (cli: CliAgent) => {
      setLaunching(cli.type);
      try {
        // biome-ignore lint/suspicious/noExplicitAny: tRPC proxy returns dynamic shape
        const agent = await trpcMutate<any>("agents.spawn", {
          projectId,
          cliType: cli.type,
          taskDescription: cli.name,
        });
        addAgent({
          id: agent.id,
          projectId,
          cliType: agent.cliType,
          status: agent.status,
          currentStep: agent.currentStep,
          taskDescription: agent.taskDescription,
          branchName: null,
          tokenUsage: { input: 0, output: 0, cost: 0 },
          startedAt: agent.startedAt,
        });
        createTerminal(agent.id);
        setFocusedAgent(agent.id);
        if (useAppStore.getState().activeView !== "workspace") {
          useAppStore.getState().setActiveView("workspace");
        }
      } catch (err) {
        console.error("[AgentLauncher] Spawn failed:", err);
      } finally {
        setLaunching(null);
        setMenuOpen(false);
      }
    },
    [projectId, addAgent, createTerminal, setFocusedAgent],
  );

  // Calculate menu position from button ref
  const rect = btnRef.current?.getBoundingClientRect();
  const menuStyle = rect
    ? { top: rect.bottom + 4, left: rect.left, position: "fixed" as const }
    : { top: 0, left: 0, position: "fixed" as const, display: "none" as const };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(!menuOpen);
        }}
        className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-accent/20 hover:text-accent"
        title="Launch agent"
      >
        <Plus className="h-3 w-3" />
      </button>

      {/* Portal menu — renders at document root to avoid overflow clipping */}
      {menuOpen &&
        createPortal(
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-[100]"
              onClick={() => setMenuOpen(false)}
              onKeyDown={() => {}}
              role="none"
            />
            {/* Menu */}
            <div
              className="z-[101] w-44 rounded-lg border border-border bg-bg-secondary p-1 shadow-2xl"
              style={menuStyle}
            >
              <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                Launch Agent
              </div>
              {CLI_AGENTS.map((cli) => (
                <button
                  key={cli.type}
                  type="button"
                  disabled={launching === cli.type}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLaunch(cli);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/5",
                    launching === cli.type && "opacity-50",
                  )}
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
                    style={{ background: cli.color }}
                  >
                    {cli.short}
                  </span>
                  <span className="font-medium text-text-primary">{cli.name}</span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
