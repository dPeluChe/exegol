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
import { type RefObject, useRef, useState } from "react";
import { useLatest } from "../../hooks/use-latest";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { isLaunchable, useEnabledProviders } from "../../hooks/use-providers";
import { isResuming, resumeHeld, useResumingStore } from "../../hooks/use-resume-agent";
import { useProject } from "../../hooks/use-trpc";
import {
  ENDED_ACTION_KEYS,
  type EndedAction,
  endedActions,
  endedFocusAllowed,
  endedHeader,
  endedKeyAction,
  endedKeysLive,
  folderLabel,
  PRIMARY_LABEL,
  statusChipText,
} from "../../lib/ended-session";
import {
  browserInPane,
  type EndedSource,
  filesInPane,
  handOver,
  newSessionInPane,
  terminalInPane,
} from "../../lib/ended-session-actions";
import { focusedField } from "../../lib/focused-field";
import { claimPaneFocus, paneRoot } from "../../lib/pane-focus";
import { trpcInvoke } from "../../lib/trpc-client";
import { useAppStore } from "../../stores/app";
import { toastError } from "../../stores/toasts";
import { getActivePaneId } from "../../stores/workspace";
import { SpawnAgentModal } from "../agents/SpawnAgentModal";
import { AgentIcon, LoadingSpinner } from "../common";

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

/** Narrow tall pane: button rows span the pane and their buttons grow to fill each row */
const ROW = "flex flex-wrap items-center justify-center gap-1.5 pane-narrow:w-full";
const FILL = "min-w-0 justify-center pane-narrow:gap-1 pane-narrow:px-2";

interface LauncherProps {
  agent: EndedAgent;
  paneId?: string;
  canResume: boolean;
  pending: boolean;
  onResume: () => void;
  /** Why there is no output to show (history lost) */
  note?: string;
  /** The self-update bar above already offers Restart session */
  hidePrimary?: boolean;
}

/** A CLI that exited (Ctrl+C, /exit, a crash): the launcher, with this session's place and
 *  choices; while a respawn is on its way (resume, restart, lost-session pass) only a spinner */
export function EndedSessionLauncher(props: LauncherProps) {
  const { agent } = props;
  const held = useResumingStore((s) => resumeHeld(agent, s));
  if (held) {
    return (
      <LoadingSpinner
        label={agent.cliType === "shell" ? "Reopening..." : "Resuming..."}
        className="py-6"
      />
    );
  }
  return <LauncherBody {...props} />;
}

function LauncherBody({
  agent,
  paneId,
  canResume,
  pending,
  onResume,
  note,
  hidePrimary,
}: LauncherProps) {
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
  const locked = pending || busy;

  const guard = (failTitle: string, fn: () => Promise<void>) => {
    setBusy(true);
    fn()
      .catch(toastError(failTitle))
      .finally(() => setBusy(false));
  };
  // One action at a time: R then N spawned two
  const run = (action: EndedAction) => {
    if (locked || isResuming(agent.id)) return;
    if (PRIMARY.has(action)) return onResume();
    if (!paneId) return;
    if (action === "new")
      guard(`${cliName} did not start`, () => newSessionInPane(agent, paneId, folder));
    if (action === "terminal")
      guard("Could not open a terminal", () => terminalInPane(agent, paneId, folder));
    if (action === "files") filesInPane(agent, paneId, folder);
    if (action === "browser")
      guard("Could not open a browser", () => browserInPane(agent, project?.path, paneId));
  };
  const pick = (provider: AgentProvider | null) => {
    if (!locked && !isResuming(agent.id)) setSwitchTo(provider);
  };

  useEndedKeys(paneId, rootRef, { agentId: agent.id, actions, others, run, pick, switchTo });

  const chip = statusChipText(agent.status, score?.exitCode, agent.suspended);
  const showDiff = !isShell && (!!agent.branchName || (score?.filesChanged ?? 0) > 0);
  const button =
    "flex items-center gap-1.5 rounded-lg border border-border bg-bg-secondary px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent/50 disabled:opacity-50";

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="@container flex w-full flex-col items-center gap-3 px-4 py-4 outline-none pane-short:flex-row pane-short:flex-wrap pane-short:justify-center pane-short:gap-x-3 pane-short:gap-y-1.5 pane-short:py-2"
    >
      <div className="flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[12px] pane-short:basis-full">
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

      <div className={ROW}>
        {actions
          .filter((a) => PRIMARY.has(a) && !hidePrimary)
          .map((a) => (
            <ActionButton
              key={a}
              action={a}
              disabled={locked}
              onClick={() => run(a)}
              className={cn(
                "rounded-lg bg-accent px-3 py-1 text-[11px] font-semibold text-white hover:bg-accent/90 disabled:opacity-50",
                FILL,
                "pane-narrow:flex-[1_1_7rem]",
              )}
            />
          ))}
        {actions.includes("new") && (
          <button
            type="button"
            disabled={locked}
            onClick={() => run("new")}
            aria-label={`New ${cliName} session here`}
            className={cn(button, FILL, "pane-narrow:flex-[1_1_7rem]")}
          >
            <Plus className="h-3 w-3 shrink-0" />
            <span className="truncate pane-short:@max-xs:hidden">New {cliName} session here</span>
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
            className={cn(button, FILL, "pane-narrow:flex-[1_1_7rem]")}
          >
            <FileDiff className="h-3 w-3 shrink-0" />
            <span className="truncate">View diff</span>
          </button>
        )}
      </div>

      {paneId && others.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          <span className="mr-1 text-[9px] font-medium uppercase tracking-wide text-text-muted @max-xs:hidden">
            Switch agent
          </span>
          {others.map((p, i) => (
            <button
              key={p.id}
              type="button"
              disabled={locked}
              onClick={() => pick(p)}
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
        <div className={ROW}>
          {actions
            .filter((a) => !PRIMARY.has(a) && a !== "new")
            .map((a) => (
              <ActionButton
                key={a}
                action={a}
                disabled={locked}
                onClick={() => run(a)}
                className={cn(button, FILL, "pane-narrow:flex-[1_1_5.5rem]")}
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
          folder={
            !agent.branchName && folder && folderLabel(folder, project?.path) ? folder : undefined
          }
          targetPaneId={paneId}
          onSpawned={(newId) => handOver(agent.id, newId)}
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
      aria-label={label}
      className={cn("flex items-center gap-1.5", className)}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate pane-short:@max-xs:hidden">{label}</span>
      <Kbd k={ENDED_ACTION_KEYS[action]} />
    </button>
  );
}

function Kbd({ k }: { k: string }) {
  return (
    <kbd className="shrink-0 rounded border border-current/30 px-1 font-sans text-[9px] opacity-70">
      {k}
    </kbd>
  );
}

interface KeyState {
  agentId: string;
  actions: EndedAction[];
  others: AgentProvider[];
  run: (action: EndedAction) => void;
  pick: (provider: AgentProvider | null) => void;
  switchTo: AgentProvider | null;
}

/** R, N, T, F, B, 1-9 with the focus inside the launcher (never stray typing meant for the CLI) */
function useEndedKeys(
  paneId: string | undefined,
  rootRef: RefObject<HTMLDivElement | null>,
  state: KeyState,
) {
  const keys = useLatest(state);
  useMountEffect(() => {
    if (!paneId) return;
    const mountedAt = Date.now();
    const focusRoot = () => rootRef.current?.focus();
    // The pane keys act on (focused, else the tab's first): focusedPaneId alone is null or stale
    // until a click, so the keys never fired after a Ctrl+C
    const isActive = () =>
      getActivePaneId() === paneId && useAppStore.getState().activeView === "workspace";
    // A new split, Cmd+] / Ctrl+Tab, or the CLI exiting in the active pane: the launcher takes
    // the keyboard, unless the user is typing in a field elsewhere
    const claim = () => {
      if (isActive() && !focusedField()) focusRoot();
    };
    if (claimPaneFocus(paneId)) focusRoot();
    else claim();
    const frame = requestAnimationFrame(claim);
    const onFocusPane = (e: Event) => {
      if ((e as CustomEvent<{ paneId: string }>).detail?.paneId === paneId) focusRoot();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!isActive() || document.querySelector('[role="dialog"]')) return;
      const { agentId, actions, others, run, pick, switchTo } = keys.current;
      const live = endedKeysLive({
        mountedAt,
        now: Date.now(),
        focusInside: endedFocusAllowed(document.activeElement as HTMLElement | null, {
          body: document.body,
          launcher: rootRef.current,
          pane: paneRoot(paneId),
        }),
        held: isResuming(agentId) || !!switchTo,
      });
      const hit = live ? endedKeyAction(e, false, actions, others.length) : null;
      if (!hit) return;
      // Capture phase, stopped here: the read-only scrollback xterm must not take it too
      e.preventDefault();
      e.stopPropagation();
      if ("action" in hit) run(hit.action);
      else pick(others[hit.agentIndex] ?? null);
    };
    window.addEventListener("exegol:focus-pane", onFocusPane);
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("exegol:focus-pane", onFocusPane);
      window.removeEventListener("keydown", onKey, true);
    };
  });
}
