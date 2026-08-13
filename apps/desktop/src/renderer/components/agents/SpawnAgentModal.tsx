import {
  type AgentAccessMode,
  type AgentCliType,
  type AgentProvider,
  YOLO_FLAGS,
} from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  FileEdit,
  GitBranch,
  History,
  Layers,
  Map as MapIcon,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProject } from "../../hooks/use-trpc";
import { useSkills } from "../../hooks/use-trpc-skills";
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
import type { ResumableSession } from "../workspace/EmptyPaneContent";

/** Last few segments — enough to recognise the repo without the modal wrapping. */
function tailPath(path: string | undefined, segments = 3): string {
  if (!path) return "…";
  const parts = path.split("/").filter(Boolean);
  return parts.length <= segments ? path : `…/${parts.slice(-segments).join("/")}`;
}

function relativeEnded(epoch: number | null): string {
  if (!epoch) return "";
  const ms = epoch > 1e12 ? epoch : epoch * 1000;
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h` : `${Math.round(hrs / 24)}d`;
}

function slugify(text: string): string {
  return `exegol/${text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50)
    .replace(/-$/, "")}`;
}

interface SpawnAgentModalProps {
  projectId: string;
  onClose: () => void;
  initialProvider?: AgentProvider;
  /** Pre-fill the task field (used by T106 "New agent with same task"). */
  initialTask?: string;
  /** Pre-select a CLI by id (overrides initialProvider when both are passed). */
  initialCliType?: string;
  /** Place the spawned agent in THIS pane instead of guessing from focus —
   *  the launcher grid lives inside a specific pane and must fill that one. */
  targetPaneId?: string;
}

/** Per-project spawn preference. A UI default, deliberately not app config:
 *  it is remembered, never synced, and a wrong value costs one checkbox click. */
const WORKTREE_PREF_KEY = "exegol.spawn.useWorktree";

function readWorktreePreference(projectId: string): boolean {
  try {
    const raw = localStorage.getItem(`${WORKTREE_PREF_KEY}.${projectId}`);
    return raw === null ? false : raw === "1";
  } catch {
    return false;
  }
}

function writeWorktreePreference(projectId: string, value: boolean): void {
  try {
    localStorage.setItem(`${WORKTREE_PREF_KEY}.${projectId}`, value ? "1" : "0");
  } catch {
    /* private mode / quota — the default just won't stick */
  }
}

export function SpawnAgentModal({
  projectId,
  onClose,
  initialProvider,
  initialTask,
  initialCliType,
  targetPaneId,
}: SpawnAgentModalProps) {
  const [task, setTask] = useState(initialTask ?? "");
  const [selectedProviderId, setSelectedProviderId] = useState(
    initialCliType ?? initialProvider?.id ?? "",
  );
  const [accessMode, setAccessMode] = useState<AgentAccessMode>("write");
  // Remembered per project: whether a repo is worked in parallel branches or by
  // several agents on ONE branch is a property of how that project is run, not
  // a per-spawn decision. Defaulting to "isolated" every time meant unchecking
  // it on every single launch for review-style work (Antonio, 2026-08-13).
  const [useWorktree, setUseWorktree] = useState(() => readWorktreePreference(projectId));
  const [branchName, setBranchName] = useState("");
  const [branchEdited, setBranchEdited] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  /** null = start a new session; otherwise the past session to resume. */
  const [resumeOf, setResumeOf] = useState<ResumableSession | null>(null);
  const [yolo, setYolo] = useState(false);
  /** Resume the provider's OWN most recent session via its resume flag. */
  const [continueLast, setContinueLast] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  /** T177: ref the worktree is cut from. Empty = the project's current branch. */
  const [baseBranch, setBaseBranch] = useState("");
  const [spawning, setSpawning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addAgent = useAgentStore((s) => s.addAgent);
  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const setFocusedAgent = useAgentStore((s) => s.setFocusedAgent);

  const { data: enabledProviders = [] } = useQuery({
    queryKey: ["enabledProviders"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listEnabledProviders"),
    staleTime: 30_000,
  });

  const { data: resumable = [] } = useQuery({
    queryKey: ["resumableSessions", projectId],
    queryFn: () => trpcInvoke<ResumableSession[]>("agents.listResumable", { projectId, limit: 20 }),
    staleTime: 10_000,
  });
  // Only this provider's sessions: `claude --resume` cannot open a codex session.
  const resumableHere = resumable.filter((r) => r.cliType === selectedProviderId);

  const { data: branchInfo } = useQuery({
    queryKey: ["projectBranches", projectId],
    queryFn: () =>
      trpcInvoke<{ current: string; branches: string[] }>("diff.listBranches", { projectId }),
    enabled: useWorktree,
    staleTime: 30_000,
  });

  const { data: project } = useProject(projectId);
  const { data: skills = [] } = useSkills(projectId, project?.path ?? null);
  const availableSkills = skills.filter((s) => s.available);

  const toggleSkill = useCallback((name: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectedProvider = enabledProviders.find((p) => p.id === selectedProviderId);
  const yoloFlag = YOLO_FLAGS[selectedProviderId];
  const resumeFlag = selectedProvider?.capabilities?.resumeFlag;

  // Switching provider must drop a selection that belongs to the old one.
  useEffect(() => {
    setResumeOf((current) => (current && current.cliType !== selectedProviderId ? null : current));
  }, [selectedProviderId]);

  // Auto-select first provider if none selected
  useEffect(() => {
    if (!selectedProviderId && enabledProviders.length > 0) {
      setSelectedProviderId(enabledProviders[0]?.id ?? "");
    }
  }, [selectedProviderId, enabledProviders]);

  // Auto-derive branch name from task
  useEffect(() => {
    if (!branchEdited && task.trim()) {
      setBranchName(slugify(task.trim()));
    }
  }, [task, branchEdited]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSpawn = useCallback(async () => {
    if (!selectedProviderId || spawning) return;
    setSpawning(true);
    try {
      // biome-ignore lint/suspicious/noExplicitAny: tRPC proxy returns dynamic shape
      const agent = await trpcMutate<any>("agents.spawn", {
        projectId,
        cliType: selectedProviderId as AgentCliType,
        taskDescription: task.trim() || selectedProvider?.name || selectedProviderId,
        useWorktree,
        branchName: useWorktree && branchName ? branchName : undefined,
        accessMode,
        skillNames: selectedSkills.size > 0 ? Array.from(selectedSkills) : undefined,
        yolo: yoloFlag ? yolo : undefined,
        baseBranch: useWorktree && baseBranch ? baseBranch : undefined,
        ...(resumeOf
          ? { resumeSession: true, resumeFromAgentId: resumeOf.agentId }
          : continueLast
            ? { resumeSession: true }
            : {}),
      });
      addAgent({
        id: agent.id,
        projectId,
        cliType: agent.cliType,
        status: agent.status,
        currentStep: agent.currentStep,
        taskDescription: agent.taskDescription,
        branchName: agent.branchName ?? (useWorktree ? branchName : null),
        alias: agent.alias ?? null,
        tokenUsage: { input: 0, output: 0, cost: 0 },
        startedAt: agent.startedAt,
        accessMode: agent.accessMode ?? null,
        claudeSessionId: null,
        activityLevel: "busy",
      });
      createTerminal(agent.id);
      setFocusedAgent(agent.id);
      // Switch to Agents section
      window.dispatchEvent(
        new CustomEvent("exegol:switch-section", { detail: { section: "agents" } }),
      );
      // T95: Reuse focused empty pane, otherwise create a new tab
      const store = useWorkspaceStore.getState();
      if (targetPaneId) {
        store.updatePane(targetPaneId, { type: "terminal", agentId: agent.id });
        onClose();
        return;
      }
      const freshPw = getProjectState();
      const activeTab = freshPw.tabs.find((t) => t.id === freshPw.activeTabId);
      const focusedId = activeTab ? getFocusedOrFirstPaneId(activeTab) : null;
      const focusedPane = focusedId ? freshPw.panes[focusedId] : null;

      if (focusedPane?.type === "empty" && focusedId) {
        store.updatePane(focusedId, { type: "terminal", agentId: agent.id });
      } else {
        const newTabId = store.addTab(agent.cliType);
        const newTab = getProjectState().tabs.find((t) => t.id === newTabId);
        if (newTab) {
          const paneId = findFirstPaneId(newTab.layout);
          if (paneId) {
            store.updatePane(paneId, { type: "terminal", agentId: agent.id });
          }
        }
      }
      onClose();
    } catch (err) {
      console.error("[SpawnAgentModal] Spawn failed:", err);
    } finally {
      setSpawning(false);
    }
  }, [
    task,
    selectedProviderId,
    accessMode,
    useWorktree,
    branchName,
    selectedSkills,
    resumeOf,
    continueLast,
    yolo,
    yoloFlag,
    baseBranch,
    selectedProvider,
    projectId,
    addAgent,
    createTerminal,
    setFocusedAgent,
    onClose,
    spawning,
    targetPaneId,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSpawn();
    },
    [onClose, handleSpawn],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dialog overlay captures keyboard
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} role="none" />

      {/* Modal */}
      <div className="relative z-10 w-[480px] rounded-xl border border-border bg-bg-primary shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Launch Agent</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 p-4">
          {/* Agent selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-text-muted" htmlFor="agent-select">
              Agent
            </label>
            <div className="flex flex-wrap gap-1.5">
              {enabledProviders.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProviderId(p.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
                    selectedProviderId === p.id
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-border bg-bg-secondary text-text-secondary hover:border-accent/30",
                  )}
                >
                  <AgentIcon provider={p.id} size={16} fallback={p.icon} fallbackColor={p.color} />
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* T161: start fresh, continue the CLI's own last session, or pick one */}
          {(resumableHere.length > 0 || resumeFlag) && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-text-muted">Session</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setResumeOf(null);
                    setContinueLast(false);
                  }}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
                    resumeOf === null && !continueLast
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-border bg-bg-secondary text-text-secondary hover:border-accent/30",
                  )}
                >
                  New
                </button>
                {/* Works without a captured handle: it is the provider's own
                    flag, which is what the user would type by hand. */}
                {resumeFlag && (
                  <button
                    type="button"
                    onClick={() => {
                      setResumeOf(null);
                      setContinueLast(true);
                    }}
                    title={`Launches with ${resumeFlag}`}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
                      continueLast
                        ? "border-accent/50 bg-accent/10 text-accent"
                        : "border-border bg-bg-secondary text-text-secondary hover:border-accent/30",
                    )}
                  >
                    <History className="h-3 w-3" />
                    Continue last
                    <code className="text-text-muted">{resumeFlag}</code>
                  </button>
                )}
                {resumableHere.slice(0, 5).map((session) => (
                  <button
                    key={session.agentId}
                    type="button"
                    onClick={() => {
                      setResumeOf(session);
                      setContinueLast(false);
                    }}
                    title={session.taskDescription}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
                      resumeOf?.agentId === session.agentId
                        ? "border-accent/50 bg-accent/10 text-accent"
                        : "border-border bg-bg-secondary text-text-secondary hover:border-accent/30",
                    )}
                  >
                    <History className="h-3 w-3 shrink-0" />
                    {/* The codename is how the user knew it; task text is the fallback. */}
                    <span className="max-w-[150px] truncate">
                      {session.alias ?? session.taskDescription.slice(0, 24)}
                    </span>
                    <span className="text-text-muted">{relativeEnded(session.endedAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Access mode selector (T58) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-text-muted">Mode</span>
            <div className="flex gap-1.5">
              {[
                {
                  mode: "write" as const,
                  label: "Full Access",
                  icon: FileEdit,
                  hint: "Read + write files",
                },
                {
                  mode: "plan" as const,
                  label: "Plan Only",
                  icon: MapIcon,
                  hint: "Analyze, no writes",
                },
                { mode: "read" as const, label: "Read Only", icon: Eye, hint: "Explore codebase" },
              ].map(({ mode, label, icon: Icon, hint }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAccessMode(mode)}
                  title={hint}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
                    accessMode === mode
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-border bg-bg-secondary text-text-secondary hover:border-accent/30",
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              ))}
            </div>
            {/* Exegol's access mode instructs the agent; this bypasses the CLI's
                OWN confirmation prompts. Same question, two layers — so they
                belong together rather than as a second thing called "mode". */}
            {yoloFlag && (
              <label className="mt-0.5 flex cursor-pointer items-center gap-2" htmlFor="yolo-mode">
                <input
                  type="checkbox"
                  id="yolo-mode"
                  checked={yolo}
                  onChange={(e) => setYolo(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-accent"
                />
                <Zap className="h-3.5 w-3.5 text-text-muted" />
                <span className="text-[11px] text-text-secondary">
                  Also skip this CLI's own confirmations{" "}
                  <code className="text-text-muted">{yoloFlag}</code>
                </span>
              </label>
            )}
          </div>

          {/* Skill picker — injected into the agent prompt via buildSpawnContext */}
          {availableSkills.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => setShowSkills((v) => !v)}
                className="flex w-fit items-center gap-1 text-[11px] font-medium text-text-muted hover:text-text-secondary"
              >
                {showSkills ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Skills (optional)
                {selectedSkills.size > 0 && (
                  <span className="text-accent">· {selectedSkills.size} selected</span>
                )}
              </button>
              <div className={cn("flex-wrap gap-1.5", showSkills ? "flex" : "hidden")}>
                {availableSkills.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => toggleSkill(s.name)}
                    title={s.description}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
                      selectedSkills.has(s.name)
                        ? "border-accent/50 bg-accent/10 text-accent"
                        : "border-border bg-bg-secondary text-text-secondary hover:border-accent/30",
                    )}
                  >
                    <Sparkles className="h-3 w-3" />
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Where the agent works. Framed as a place, not a git feature: the
              question the user is answering is "which directory will this touch",
              and the answer should always be visible — never inferred. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-text-muted">Where to work</span>
            <div className="flex gap-1.5">
              {[
                {
                  isolated: false,
                  label: "Here",
                  hint: "The project checkout, shared with others",
                },
                { isolated: true, label: "Worktree", hint: "Its own branch, for parallel work" },
              ].map(({ isolated, label, hint }) => (
                <button
                  key={label}
                  type="button"
                  title={hint}
                  onClick={() => {
                    setUseWorktree(isolated);
                    writeWorktreePreference(projectId, isolated);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
                    useWorktree === isolated
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-border bg-bg-secondary text-text-secondary hover:border-accent/30",
                  )}
                >
                  {isolated ? <GitBranch className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                  {label}
                </button>
              ))}
            </div>

            {/* The path is shown, never edited — only the branch is yours to
                name. Knowing where the work lands beats being able to move it. */}
            <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
              <span className="shrink-0">Path</span>
              <code title={project?.path ?? ""}>{tailPath(project?.path)}</code>
              {project?.path && (
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(project.path)}
                  title="Copy full path"
                  className="text-text-muted hover:text-text-secondary"
                >
                  <Copy className="h-3 w-3" />
                </button>
              )}
            </div>

            {useWorktree && (
              <div className="flex flex-col gap-1.5">
                {/* Which branch it is CUT FROM. Was always the repo's HEAD and
                    never stated, so an agent silently inherited whatever the
                    main checkout was on (T177). */}
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-[10px] text-text-muted">from</span>
                  <select
                    value={baseBranch || branchInfo?.current || ""}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent/50"
                  >
                    {(branchInfo?.branches ?? []).map((b) => (
                      <option key={b} value={b}>
                        {b}
                        {b === branchInfo?.current ? " (current)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-[10px] text-text-muted">new</span>
                  <input
                    type="text"
                    value={branchName}
                    onChange={(e) => {
                      setBranchName(e.target.value);
                      setBranchEdited(true);
                    }}
                    placeholder="exegol/branch-name"
                    className="flex-1 rounded border border-border bg-bg-secondary px-2 py-1 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
                  />
                </div>
              </div>
            )}
          </div>
          {/* Task prompt */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-text-muted" htmlFor="task-prompt">
              Task · prompt · greeting <span className="text-text-muted">(optional)</span>
            </label>
            <textarea
              ref={textareaRef}
              id="task-prompt"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Sent to the agent as its first message — a task, a prompt, or just a hello"
              rows={3}
              className="resize-none rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-[10px] text-text-muted">
            {selectedProvider ? `${selectedProvider.name}` : "Select an agent"}
            {useWorktree ? " · worktree" : " · main repo"}
            {accessMode !== "write" ? ` · ${accessMode}` : ""}
            {selectedSkills.size > 0
              ? ` · ${selectedSkills.size} skill${selectedSkills.size > 1 ? "s" : ""}`
              : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedProviderId || spawning}
              onClick={handleSpawn}
              className={cn(
                "rounded-lg px-4 py-1.5 text-[11px] font-semibold transition-all",
                task.trim() && selectedProviderId && !spawning
                  ? "bg-accent text-white hover:bg-accent/90"
                  : "bg-bg-tertiary text-text-muted cursor-not-allowed",
              )}
            >
              {spawning ? "Launching..." : "Launch"}
              <span className="ml-1 text-[9px] opacity-60">Cmd+Enter</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
