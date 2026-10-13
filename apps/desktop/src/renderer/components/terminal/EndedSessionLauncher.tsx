import type { AgentProvider, AgentScoreRow, AgentStatus } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import {
  FileDiff,
  FolderTree,
  Globe,
  type LucideIcon,
  Play,
  Plus,
  RotateCcw,
  Terminal,
} from "lucide-react";
import { useRef, useState } from "react";
import { useLatest } from "../../hooks/use-latest";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { isLaunchable, useEnabledProviders } from "../../hooks/use-providers";
import { useProject } from "../../hooks/use-trpc";
import {
  ENDED_ACTION_KEYS,
  type EndedAction,
  endedActions,
  endedHeader,
  endedKeyAction,
  folderLabel,
  PRIMARY_LABEL,
  statusChipText,
} from "../../lib/ended-session";
import {
  browserInPane,
  type EndedSource,
  filesInPane,
  newSessionInPane,
  retireEnded,
  terminalInPane,
} from "../../lib/ended-session-actions";
import { focusedField } from "../../lib/focused-field";
import { claimPaneFocus, paneRoot } from "../../lib/pane-focus";
import { trpcInvoke } from "../../lib/trpc-client";
import { useAppStore } from "../../stores/app";
import { toastError } from "../../stores/toasts";
import { useWorkspaceStore } from "../../stores/workspace";
import { SpawnAgentModal } from "../agents/SpawnAgentModal";
import { AgentIcon } from "../common";

export type EndedAgent = EndedSource & {
  status: AgentStatus;
  alias?: string | null;
  currentStep?: string | null;
  suspended?: boolean;
};

const CHIP_TONE: Partial<Record<AgentStatus, string>> = {
  completed: "border-green-500/30 bg-green-500/10 text-green-300",
  failed: "border-red-500/30 bg-red-500/10 text-red-300",
  crashed: "border-red-500/40 bg-red-500/15 text-red-300",
};
const CHIP_DEFAULT = "border-yellow-500/30 bg-yellow-500/10 text-yellow-300";

const ACTION_META: Record<EndedAction, { icon: LucideIcon; label: string }> = {
  resume: { icon: Play, label: PRIMARY_LABEL.resume },
  restart: { icon: RotateCcw, label: PRIMARY_LABEL.restart },
  reopen: { icon: Terminal, label: PRIMARY_LABEL.reopen },
  new: { icon: Plus, label: "New session" },
  terminal: { icon: Terminal, label: "Terminal" },
  files: { icon: FolderTree, label: "Files" },
  browser: { icon: Globe, label: "Browser" },
};

const PRIMARY = new Set<EndedAction>(["resume", "restart", "reopen"]);

/** A CLI that exited (Ctrl+C, /exit, a crash): the launcher, with this session's place and choices */
export function EndedSessionLauncher({
  agent,
  paneId,
  canResume,
  pending,
  onResume,
  note,
}: {
  agent: EndedAgent;
  paneId?: string;
  canResume: boolean;
  pending: boolean;
  onResume: () => void;
  /** Why there is no output to show (history lost) */
  note?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [switchTo, setSwitchTo] = useState<AgentProvider | null>(null);
  const providers = useEnabledProviders();
  const { data: project } = useProject(agent.projectId);
  const { data: folder = null } = useQuery({
    queryKey: ["sessionFolder", agent.id],
    queryFn: () => trpcInvoke<string | null>("agents.sessionFolder", { agentId: agent.id }),
    staleTime: 30_000,
  });
  const { data: score } = useQuery({
    queryKey: ["agentScore", agent.id],
    queryFn: () => trpcInvoke<AgentScoreRow | null>("scoring.getScore", { agentId: agent.id }),
    staleTime: 30_000,
  });

  const isShell = agent.cliType === "shell";
  const cliName =
    providers.find((p) => p.id === agent.cliType)?.name ?? (isShell ? "Terminal" : agent.cliType);
  const others = providers
    .filter((p) => isLaunchable(p) && p.id !== "shell" && p.id !== agent.cliType)
    .slice(0, 9);
  const actions = endedActions({ isShell, canResume, hasPane: !!paneId });
  const [title, ...rest] = endedHeader({
    cliName,
    name: agent.alias,
    projectName: project?.name,
    folder: folderLabel(folder, project?.path),
    suspended: agent.suspended,
  });

  const guard = (failTitle: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    fn()
      .catch(toastError(failTitle))
      .finally(() => setBusy(false));
  };
  const run = (action: EndedAction) => {
    if (PRIMARY.has(action)) {
      if (!pending) onResume();
      return;
    }
    if (!paneId) return;
    if (action === "new") guard(`${cliName} did not start`, () => newSessionInPane(agent, paneId));
    if (action === "terminal")
      guard("Could not open a terminal", () =>
        terminalInPane(agent.id, agent.projectId, paneId, folder),
      );
    if (action === "files") filesInPane(agent.id, paneId, folder);
    if (action === "browser")
      guard("Could not open a browser", () =>
        browserInPane(agent.id, agent.projectId, project?.path, paneId),
      );
  };

  const keys = useLatest({ actions, others, run, switching: !!switchTo });
  useMountEffect(() => {
    if (!paneId) return;
    // Like an empty pane: a new split or Cmd+] / Ctrl+Tab hands it the keyboard
    if (claimPaneFocus(paneId)) rootRef.current?.focus();
    const onFocusPane = (e: Event) => {
      if ((e as CustomEvent<{ paneId: string }>).detail?.paneId === paneId) {
        rootRef.current?.focus();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (useWorkspaceStore.getState().focusedPaneId !== paneId) return;
      if (useAppStore.getState().activeView !== "workspace") return;
      if (document.querySelector('[role="dialog"]')) return;
      const active = document.activeElement;
      const inPane = !active || active === document.body || !!paneRoot(paneId)?.contains(active);
      const typing = !!focusedField() || active instanceof HTMLSelectElement;
      const { actions, others, run, switching } = keys.current;
      const hit = inPane && !switching ? endedKeyAction(e, typing, actions, others.length) : null;
      if (!hit) return;
      e.preventDefault();
      if ("action" in hit) run(hit.action);
      else setSwitchTo(others[hit.agentIndex] ?? null);
    };
    window.addEventListener("exegol:focus-pane", onFocusPane);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("exegol:focus-pane", onFocusPane);
      window.removeEventListener("keydown", onKey);
    };
  });

  const chip = statusChipText(agent.status, score?.exitCode, agent.suspended);
  const showDiff = !isShell && (!!agent.branchName || (score?.filesChanged ?? 0) > 0);
  const button =
    "flex items-center gap-1.5 rounded-lg border border-border bg-bg-secondary px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent/50 disabled:opacity-50";

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="flex w-full flex-col items-center gap-3 px-4 py-4 outline-none"
    >
      <div className="flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[12px]">
        <AgentIcon provider={agent.cliType} size={16} />
        <span className="font-semibold text-text-primary">{title}</span>
        {rest.map((part) => (
          <span key={part} className="truncate text-text-muted">
            · {part}
          </span>
        ))}
        <span
          className={cn(
            "rounded border px-1.5 py-px text-[10px]",
            (!agent.suspended && CHIP_TONE[agent.status]) || CHIP_DEFAULT,
          )}
        >
          {chip}
        </span>
      </div>
      {/* The only readable trace of why a spawn died (verify 2026-08-12) */}
      {agent.status !== "completed" && agent.currentStep && (
        <p className="max-w-md rounded border border-border/60 bg-black/20 px-2 py-1 font-mono text-[10px] leading-relaxed text-text-secondary">
          {agent.currentStep}
        </p>
      )}
      {note && <p className="text-[11px] text-text-muted">{note}</p>}

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {actions
          .filter((a) => PRIMARY.has(a))
          .map((a) => (
            <ActionButton
              key={a}
              action={a}
              disabled={pending || busy}
              onClick={() => run(a)}
              className="rounded-lg bg-accent px-3 py-1 text-[11px] font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
            />
          ))}
        {actions.includes("new") && (
          <button type="button" disabled={busy} onClick={() => run("new")} className={button}>
            <Plus className="h-3 w-3" />
            New {cliName} session here
            <Kbd k={ENDED_ACTION_KEYS.new} />
          </button>
        )}
        {showDiff && (
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("exegol:view-diff", { detail: { agentId: agent.id } }),
              )
            }
            className={button}
          >
            <FileDiff className="h-3 w-3" />
            View diff
          </button>
        )}
      </div>

      {paneId && others.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          <span className="mr-1 text-[9px] font-medium uppercase tracking-wide text-text-muted">
            Switch agent
          </span>
          {others.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSwitchTo(p)}
              title={`${p.name} here (${i + 1})`}
              className="relative flex items-center rounded-md border border-border bg-bg-secondary p-1 transition-colors hover:border-accent/50"
            >
              <AgentIcon provider={p.id} size={16} fallback={p.icon} fallbackColor={p.color} />
              <span className="absolute -right-1 -top-1 rounded bg-bg-tertiary px-0.5 text-[8px] text-text-muted">
                {i + 1}
              </span>
            </button>
          ))}
        </div>
      )}

      {paneId && (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {actions
            .filter((a) => !PRIMARY.has(a) && a !== "new")
            .map((a) => (
              <ActionButton
                key={a}
                action={a}
                disabled={busy}
                onClick={() => run(a)}
                className={button}
              />
            ))}
        </div>
      )}

      {switchTo && paneId && (
        <SpawnAgentModal
          projectId={agent.projectId}
          initialProvider={switchTo}
          initialCliType={switchTo.id}
          initialAccessMode={agent.accessMode ?? "write"}
          initialBranch={agent.branchName}
          targetPaneId={paneId}
          onSpawned={() => retireEnded(agent.id)}
          onClose={() => setSwitchTo(null)}
        />
      )}
    </div>
  );
}

function ActionButton({
  action,
  disabled,
  onClick,
  className,
}: {
  action: EndedAction;
  disabled: boolean;
  onClick: () => void;
  className: string;
}) {
  const { icon: Icon, label } = ACTION_META[action];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn("flex items-center gap-1.5", className)}
    >
      <Icon className="h-3 w-3" />
      {label}
      <Kbd k={ENDED_ACTION_KEYS[action]} />
    </button>
  );
}

function Kbd({ k }: { k: string }) {
  return (
    <kbd className="rounded border border-current/30 px-1 font-sans text-[9px] opacity-70">{k}</kbd>
  );
}
