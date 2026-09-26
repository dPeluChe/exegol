import type { AgentAccessMode, AgentProvider, ResumableSession } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  Eye,
  FileEdit,
  Globe,
  History,
  Map as MapIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { projectBrowserUrl } from "../../lib/project-browser-url";
import { trpcInvoke } from "../../lib/trpc-client";
import { useWorkspaceStore } from "../../stores/workspace";
import { type SessionChoice, SpawnAgentModal } from "../agents/SpawnAgentModal";
import { AgentIcon } from "../common";
import { RunTargets } from "./RunTargets";

// ─── Empty Pane (Agent Grid) ────────────────────────────────────────────────

/** Stable identity while the providers query loads — a fresh [] each render
 *  invalidates every callback that depends on it. */
const NO_PROVIDERS: AgentProvider[] = [];

function relativeTime(epoch: number | null): string {
  if (!epoch) return "";
  const ms = epoch > 1e12 ? epoch : epoch * 1000;
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function EmptyPane({ paneId }: { paneId: string }) {
  const { projectId, project } = useProjectContext();
  const [modalProvider, setModalProvider] = useState<AgentProvider | null>(null);
  const [modalSession, setModalSession] = useState<SessionChoice>(null);
  const [search, setSearch] = useState("");
  const [accessMode, setAccessMode] = useState<AgentAccessMode>("write");
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<"full" | "compact" | "mini">("full");
  const { data: providers } = useQuery({
    queryKey: ["enabledProviders"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listEnabledProviders"),
    staleTime: 30_000,
  });
  // T155.5: cross-provider resumable session history for this project
  const [showSessions, setShowSessions] = useState(false);
  const { data: resumableSessions } = useQuery({
    queryKey: ["resumableSessions", projectId, 10],
    queryFn: () => trpcInvoke<ResumableSession[]>("agents.listResumable", { projectId, limit: 10 }),
    enabled: !!projectId,
    staleTime: 15_000,
  });
  const cliOptions = providers ?? NO_PROVIDERS;
  // Only offer resume for providers still enabled (e.g. gemini sessions hide once retired)
  const sessions = (resumableSessions ?? []).filter((s) =>
    cliOptions.some((c) => c.id === s.cliType),
  );
  const filteredOptions = search
    ? cliOptions.filter(
        (cli) =>
          cli.name.toLowerCase().includes(search.toLowerCase()) ||
          cli.id.toLowerCase().includes(search.toLowerCase()),
      )
    : cliOptions;

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

  // Opens the spawn modal instead of launching immediately. This grid used to
  // fire a bare `cli.name` task with no session choice, no worktree decision
  // and no YOLO — so every launch from here had to be fixed up inside the
  // terminal afterwards (Antonio, 2026-08-13). The modal fills THIS pane.
  const handleLaunchAgent = useCallback((cli: AgentProvider) => {
    setModalSession(null);
    setModalProvider(cli);
  }, []);

  // Resume goes through the SAME modal as a fresh launch: from here it could not
  // pick a worktree, a base branch or YOLO, which is exactly the gap the launch
  // migration existed to close (Antonio, 2026-08-13).
  const handleResumeSession = useCallback(
    (session: ResumableSession) => {
      const provider = cliOptions.find((c) => c.id === session.cliType);
      if (!provider) return;
      setModalSession(session);
      setModalProvider(provider);
    },
    [cliOptions],
  );

  const handleBrowser = useCallback(async () => {
    updatePane(paneId, { type: "browser", url: await projectBrowserUrl(projectId, project?.path) });
  }, [paneId, projectId, project?.path, updatePane]);

  const isMini = size === "mini";
  const isCompact = size === "compact" || isMini;
  const iconSize = isMini ? 18 : isCompact ? 22 : 28;
  const gridCols = isMini ? "grid-cols-3" : isCompact ? "grid-cols-4" : "grid-cols-4";

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

      {/* Search filter — only shown when enough agents */}
      {!isMini && cliOptions.length > 6 && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents..."
          className="mb-2 w-full max-w-sm rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
        />
      )}

      {/* Agent grid — responsive columns and sizes */}
      <div className={cn("grid w-full gap-1.5", gridCols, isMini ? "max-w-xs" : "max-w-sm")}>
        {filteredOptions.map((cli) => (
          <button
            key={cli.id}
            type="button"
            onClick={() => handleLaunchAgent(cli)}
            className={cn(
              "flex flex-col items-center rounded-lg border border-border bg-bg-secondary transition-all hover:border-accent/50 hover:bg-white/[0.03]",
              isMini ? "gap-0.5 p-1.5" : isCompact ? "gap-1 p-2" : "gap-1.5 p-2.5",
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

      {/* T155.5: resumable session history — collapsed by default, 1-5 rows by pane size */}
      {sessions.length > 0 && (
        <div className={cn("mt-2 w-full shrink-0", isMini ? "max-w-xs" : "max-w-sm")}>
          <button
            type="button"
            onClick={() => setShowSessions(!showSessions)}
            className="flex w-full items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-text-muted transition-colors hover:text-text-secondary"
          >
            {showSessions ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
            <History className="h-2.5 w-2.5" />
            <span>Recent sessions ({sessions.length})</span>
          </button>
          {showSessions && (
            <div className="mt-1 space-y-0.5">
              {sessions.slice(0, isMini ? 1 : isCompact ? 3 : 5).map((s) => (
                <button
                  key={s.agentId}
                  type="button"
                  onClick={() => handleResumeSession(s)}
                  className="flex w-full items-center gap-1.5 rounded border border-border/50 bg-bg-secondary px-2 py-1 transition-all hover:border-accent/50 hover:bg-white/[0.03]"
                  title={`Resume: ${s.taskDescription || s.cliType}`}
                >
                  <AgentIcon provider={s.cliType} size={12} />
                  <span className="flex-1 truncate text-left text-[10px] text-text-secondary">
                    {s.taskDescription || s.cliType}
                  </span>
                  <span className="shrink-0 text-[9px] tabular-nums text-text-muted">
                    {relativeTime(s.endedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Access mode toggle — hidden in mini */}
      {!isMini && (
        <div className="flex items-center justify-center gap-1 mt-1.5 mb-1">
          {(
            [
              { mode: "write" as const, icon: FileEdit, title: "Write — full code edits" },
              { mode: "plan" as const, icon: MapIcon, title: "Plan — suggest changes only" },
              { mode: "read" as const, icon: Eye, title: "Read — no file writes" },
            ] as const
          ).map(({ mode, icon: ModeIcon, title }) => (
            <button
              key={mode}
              type="button"
              title={title}
              onClick={() => setAccessMode(mode)}
              className={cn(
                "flex items-center justify-center rounded-md border p-1 transition-all",
                accessMode === mode
                  ? "bg-accent/10 text-accent border-accent/50"
                  : "border-border bg-bg-secondary text-text-muted hover:border-accent/30",
              )}
            >
              <ModeIcon className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      {/* Pane options — compact in small sizes */}
      <div className={cn("flex shrink-0 items-center", isMini ? "mt-1.5 gap-1" : "mt-3 gap-2")}>
        {/* Terminal, Files and Git act on a folder: they live in the Run-in row below */}
        {[{ handler: handleBrowser, icon: Globe, label: "Browser" }].map(
          ({ handler, icon: PaneIcon, label }) => (
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
          ),
        )}
      </div>

      {projectId && <RunTargets projectId={projectId} paneId={paneId} compact={isCompact} />}
      {modalProvider && (
        <SpawnAgentModal
          projectId={projectId ?? ""}
          initialProvider={modalProvider}
          initialCliType={modalProvider.id}
          initialSession={modalSession}
          initialAccessMode={accessMode}
          targetPaneId={paneId}
          onClose={() => setModalProvider(null)}
        />
      )}
    </div>
  );
}
