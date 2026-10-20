import type { AgentProvider, ResumableSession } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { useCliInstalls } from "../../hooks/use-cli-updates";
import { isLaunchable, useEnabledProviders } from "../../hooks/use-providers";
import { fileManagerLabel } from "../../lib/keymap";
import { launcherActions, launcherFolder, orderedCommands } from "../../lib/launcher";
import { sessionsInFolder } from "../../lib/launcher-sessions";
import { useWorkspaceStore } from "../../stores/workspace";
import { type SessionChoice, SpawnAgentModal } from "../agents/SpawnAgentModal";
import { useResumableSessions } from "../agents/SpawnSessionPicker";
import { AgentIcon } from "../common";
import { FolderActions } from "./FolderActions";
import { LauncherFolderPicker } from "./LauncherFolderPicker";
import { PaneLaunchForm } from "./PaneLaunchForm";
import { useLauncherActions, useProjectDetect, useRunPins } from "./use-launcher-actions";
import { useLauncherKeys } from "./use-launcher-keys";

// ─── Empty Pane (launcher) ──────────────────────────────────────────────────

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

type PaneSize = "full" | "compact" | "narrow" | "mini";

/** Everything that changes with the pane size, so the JSX reads one row instead of ternaries */
const SIZE_LAYOUT: Record<
  PaneSize,
  {
    isMini: boolean;
    isCompact: boolean;
    iconSize: number;
    card: string;
    sessionRows: number;
  }
> = {
  full: {
    isMini: false,
    isCompact: false,
    iconSize: 28,
    card: "gap-1.5 p-2.5",
    sessionRows: 5,
  },
  compact: {
    isMini: false,
    isCompact: true,
    iconSize: 22,
    card: "gap-1 p-2",
    sessionRows: 3,
  },
  // Tall but under 300px: the modal like mini, tiles sized like compact
  narrow: {
    isMini: true,
    isCompact: true,
    iconSize: 22,
    card: "gap-1 p-2",
    sessionRows: 3,
  },
  mini: {
    isMini: true,
    isCompact: true,
    iconSize: 18,
    card: "gap-0.5 p-1.5",
    sessionRows: 1,
  },
};

type SizeLayout = (typeof SIZE_LAYOUT)[PaneSize];

/** Pane size class for what CSS cannot do (the mini modal, icon size, session rows); columns and
 *  widths follow container queries so they reflow continuously while a split is dragged */
function usePaneSize() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<PaneSize>("full");
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      if (h < 250) setSize("mini");
      else if (w < 300) setSize("narrow");
      else if (w < 500 || h < 400) setSize("compact");
      else setSize("full");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { containerRef, size };
}

interface Picked {
  provider: AgentProvider;
  session: SessionChoice;
}

/**
 * T204: the launcher, built around a folder ("project / folder ▾", the root by default, kept per
 * pane). Agents, the pane's own views and the folder's commands all start there; an agent picked
 * (click or 1-9) turns the pane into its launch form. Mini panes use the modal instead
 */
export function EmptyPane({ paneId, folder: remembered }: { paneId: string; folder?: string }) {
  const { projectId, project } = useProjectContext();
  const updatePane = useWorkspaceStore((s) => s.updatePane);
  const { containerRef, size } = usePaneSize();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const { detect, refresh } = useProjectDetect(projectId ?? "");
  const folders = detect?.folders ?? [];
  const folder = launcherFolder(folders, remembered);
  const atRoot = !folder || folder.rel === "";
  const folderPath = atRoot ? undefined : folder?.path;
  const folderName = atRoot ? (project?.name ?? "the project") : (folder?.rel ?? "");

  const providers = useEnabledProviders().filter(isLaunchable);
  const { data: resumable = [] } = useResumableSessions(projectId);
  const recent = sessionsInFolder(
    resumable.filter((s) => providers.some((p) => p.id === s.cliType)),
    { folder: folder?.path ?? project?.path ?? "", projectPath: project?.path ?? "" },
  );

  const { run, runCommand, launching } = useLauncherActions({
    projectId: projectId ?? "",
    projectPath: project?.path,
    paneId,
    folder,
  });
  const { pins } = useRunPins(projectId ?? "");
  const commands = folder ? orderedCommands(folder.scripts, pins, folder.rel) : [];
  const actions = launcherActions({ atRoot, git: !!folder?.git, editor: !!detect?.editor });
  const layout = SIZE_LAYOUT[size];
  const fileManager = detect?.fileManager || fileManagerLabel();

  const backToGrid = () => {
    setPicked(null);
    requestAnimationFrame(() => containerRef.current?.focus());
  };
  const closeFolders = () => {
    setFolderOpen(false);
    requestAnimationFrame(() => containerRef.current?.focus());
  };
  const chooseFolder = (rel: string) => {
    updatePane(paneId, { launcherFolder: rel });
    closeFolders();
  };
  const pick = (provider: AgentProvider, session: SessionChoice = null) =>
    setPicked({ provider, session });

  useLauncherKeys(paneId, containerRef, {
    enabled: !picked && !folderOpen,
    actions,
    agentCount: Math.min(providers.length, 9),
    commandCount: Math.min(commands.length, 9),
    onKey: (hit) => {
      if ("folder" in hit) setFolderOpen(true);
      else if ("action" in hit) run(hit.action, fileManager);
      else if ("commandIndex" in hit) {
        const command = commands[hit.commandIndex];
        if (command) void runCommand(command.name, command.command);
      } else {
        const provider = providers[hit.agentIndex];
        if (provider) pick(provider);
      }
    },
  });

  const inPaneForm = picked && !layout.isMini;
  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="@container-[size] h-full overflow-y-auto outline-none"
    >
      <div
        className={cn(
          "flex min-h-full flex-col items-center p-3",
          inPaneForm
            ? "justify-start"
            : "justify-center pane-short:flex-row pane-short:flex-wrap pane-short:content-center pane-short:gap-x-3 pane-short:gap-y-1.5",
        )}
      >
        {inPaneForm && picked ? (
          <PaneLaunchForm
            key={picked.provider.id}
            projectId={projectId ?? ""}
            paneId={paneId}
            provider={picked.provider}
            session={picked.session}
            accessMode="write"
            folder={folderPath}
            folderName={folderName}
            onBack={backToGrid}
          />
        ) : (
          <>
            {folder && (
              <LauncherFolderPicker
                projectName={project?.name ?? "Project"}
                folders={folders}
                selected={folder}
                open={folderOpen}
                onOpen={() => setFolderOpen(true)}
                onClose={closeFolders}
                onSelect={chooseFolder}
                onRefresh={() => refresh.mutate()}
                refreshing={refresh.isPending}
                compact={layout.isCompact}
              />
            )}
            <AgentGrid options={providers} layout={layout} onLaunch={(p) => pick(p)} />
            {!layout.isMini && <MissingAgents installed={providers.length} />}
            {recent.sessions.length > 0 && (
              <RecentSessions
                sessions={recent.sessions}
                elsewhere={recent.scope === "project"}
                layout={layout}
                onResume={(s) => {
                  const provider = providers.find((p) => p.id === s.cliType);
                  if (provider) pick(provider, s);
                }}
              />
            )}
            {folder && (
              <div
                className={cn(
                  "w-full max-w-sm pane-short:mt-0 pane-short:w-auto pane-short:max-w-full",
                  layout.isMini ? "mt-1.5" : "mt-3",
                )}
              >
                <FolderActions
                  projectId={projectId ?? ""}
                  folder={folder}
                  actions={actions}
                  labels={{ finder: fileManager, editor: detect?.editor?.label ?? "Editor" }}
                  launching={launching}
                  compact={layout.isCompact}
                  onAction={(a) => run(a, fileManager)}
                  onCommand={(label, command) => void runCommand(label, command)}
                />
              </div>
            )}
          </>
        )}
        {picked && layout.isMini && (
          <SpawnAgentModal
            projectId={projectId ?? ""}
            initialProvider={picked.provider}
            initialCliType={picked.provider.id}
            initialSession={picked.session}
            folder={folderPath}
            targetPaneId={paneId}
            onClose={backToGrid}
          />
        )}
      </div>
    </div>
  );
}

function MissingAgents({ installed }: { installed: number }) {
  const missing = useEnabledProviders().length - installed;
  if (missing <= 0) return null;
  return (
    <p className="mt-1 text-[10px] text-text-muted pane-short:order-last pane-short:mt-0 pane-short:basis-full pane-short:text-center">
      {installed === 0
        ? "No agent CLI is installed on this machine yet: "
        : `${missing} more not installed: `}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("exegol:spawn-agent"))}
        className="underline hover:text-text-secondary"
      >
        see how to install them
      </button>
    </p>
  );
}

/** Agent grid in key order: 1-9 badges on the first nine */
function AgentGrid({
  options,
  layout,
  onLaunch,
}: {
  options: AgentProvider[];
  layout: SizeLayout;
  onLaunch: (cli: AgentProvider) => void;
}) {
  const installs = useCliInstalls();
  return (
    <div
      className={cn(
        "mt-2 grid w-full max-w-sm grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-1.5 @max-[12rem]:grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] pane-short:mt-0 pane-short:flex pane-short:w-auto pane-short:max-w-full pane-short:flex-wrap pane-short:justify-center",
      )}
    >
      {options.map((cli, i) => (
        <button
          key={cli.id}
          type="button"
          onClick={() => onLaunch(cli)}
          title={i < 9 ? `${cli.name} (${i + 1})` : cli.name}
          className={cn(
            "relative flex min-w-0 flex-col items-center rounded-lg border border-border bg-bg-secondary transition-colors hover:border-accent/50 hover:bg-white/[0.03]",
            layout.card,
            "pane-short:flex-row pane-short:py-1 pane-short:pr-2 pane-short:pl-5",
          )}
        >
          <AgentIcon
            provider={cli.id}
            size={layout.iconSize}
            fallback={cli.icon}
            fallbackColor={cli.color}
          />
          {i < 9 && (
            <span className="absolute left-1 top-1 rounded border border-border/80 bg-bg-tertiary px-1 text-[8px] font-medium leading-tight text-text-muted">
              {i + 1}
            </span>
          )}
          <DuplicateInstallsBadge count={installs.get(cli.id)?.length ?? 0} />
          <span
            className={cn(
              "max-w-full truncate font-medium text-text-secondary @max-[12rem]:hidden pane-short:@max-xs:hidden",
              layout.isCompact ? "text-[8px]" : "text-[9px]",
            )}
          >
            {cli.name}
          </span>
        </button>
      ))}
    </div>
  );
}

/** 2+ copies of the CLI on PATH: the details and remove commands are in Settings > CLIs */
function DuplicateInstallsBadge({ count }: { count: number }) {
  if (count < 2) return null;
  return (
    <span
      className="absolute right-1 top-1 rounded bg-amber-500/15 px-1 text-[8px] font-medium text-amber-400"
      title={`${count} installs on PATH: the first one runs and an update may land in another. See Settings > CLIs`}
    >
      {count}x
    </span>
  );
}

/** T155.5: past sessions in this folder (else the project's, said so); collapsed by default */
function RecentSessions({
  sessions,
  elsewhere,
  layout,
  onResume,
}: {
  sessions: ResumableSession[];
  elsewhere: boolean;
  layout: SizeLayout;
  onResume: (session: ResumableSession) => void;
}) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="mt-2 w-full max-w-sm shrink-0 pane-short:order-last pane-short:mt-0 pane-short:basis-full">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-text-muted transition-colors hover:text-text-secondary"
      >
        <Chevron className="h-2.5 w-2.5" />
        <History className="h-2.5 w-2.5" />
        <span>
          Recent sessions{elsewhere ? " in the project" : ""} ({sessions.length})
        </span>
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {sessions.slice(0, layout.sessionRows).map((s) => (
            <button
              key={s.agentId}
              type="button"
              onClick={() => onResume(s)}
              className="flex w-full items-center gap-1.5 rounded border border-border/50 bg-bg-secondary px-2 py-1 transition-colors hover:border-accent/50 hover:bg-white/[0.03]"
              title={`Resume: ${s.taskDescription || s.cliType}`}
            >
              <AgentIcon provider={s.cliType} size={12} />
              <span className="flex-1 truncate text-left text-[10px] text-text-secondary">
                {s.alias ?? (s.taskDescription || s.cliType)}
              </span>
              <span className="shrink-0 text-[9px] tabular-nums text-text-muted">
                {relativeTime(s.endedAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
