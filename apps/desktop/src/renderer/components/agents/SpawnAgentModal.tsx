import { type AgentAccessMode, type AgentProvider, MODEL_ID_PATTERN } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useEnabledProviders, useRecheckProviders } from "../../hooks/use-providers";
import { editKeys } from "../../lib/keymap";
import {
  AccessModePicker,
  InstallHint,
  ModelAndName,
  ProviderPicker,
  SkillPicker,
} from "./SpawnOptions";
import { SpawnSessionPicker } from "./SpawnSessionPicker";
import { SpawnWorkLocation } from "./SpawnWorkLocation";
import { useSpawnAgent } from "./use-spawn-agent";
import { type SessionChoice, useSpawnForm } from "./use-spawn-form";

export type { SessionChoice } from "./use-spawn-form";

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
  /** Open with a session already chosen — the launcher's history chips resume
   *  through this modal rather than spawning behind its back. */
  initialSession?: SessionChoice;
  initialAccessMode?: AgentAccessMode;
}

export function SpawnAgentModal({
  projectId,
  onClose,
  initialProvider,
  initialTask,
  initialCliType,
  targetPaneId,
  initialSession = null,
  initialAccessMode = "write",
}: SpawnAgentModalProps) {
  // All enabled ones: the picker groups those not installed and the form starts on one that is
  const enabledProviders = useEnabledProviders();
  const form = useSpawnForm({
    projectId,
    enabledProviders,
    initialProvider,
    initialTask,
    initialCliType,
    initialSession,
    initialAccessMode,
  });
  const { spawning, spawn } = useSpawnAgent({ projectId, targetPaneId, onClose });
  const recheck = useRecheckProviders();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const modelOk = !form.model.trim() || MODEL_ID_PATTERN.test(form.model.trim());
  const notInstalled = form.provider?.installed === false;
  const canLaunch = !!form.providerId && modelOk && !notInstalled && !spawning;

  const handleSpawn = () => {
    if (canLaunch) spawn(form);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSpawn();
  };

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
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 p-4">
          <ProviderPicker
            providers={enabledProviders}
            selectedId={form.providerId}
            onChoose={form.chooseProvider}
          />
          {notInstalled && form.provider && (
            <InstallHint provider={form.provider} projectId={projectId} onRecheck={recheck} />
          )}
          <ModelAndName
            key={form.providerId}
            providerId={form.providerId}
            model={form.model}
            onModel={form.setModel}
            name={form.name}
            onName={form.setName}
          />
          <SpawnSessionPicker
            projectId={projectId}
            providerId={form.providerId}
            resumeFlag={form.provider?.capabilities?.resumeFlag}
            useWorktree={form.useWorktree}
            session={form.session}
            onSession={form.chooseSession}
            localSessionId={form.localSessionId}
            onLocalSession={form.chooseLocalSession}
          />
          <AccessModePicker
            accessMode={form.accessMode}
            onAccessMode={form.setAccessMode}
            provider={form.provider}
            yoloFlag={form.yoloFlag}
            yolo={form.yolo}
            onYolo={form.setYolo}
          />
          <SkillPicker
            projectId={projectId}
            selected={form.selectedSkills}
            onToggle={form.toggleSkill}
          />
          <SpawnWorkLocation
            projectId={projectId}
            providerId={form.providerId}
            task={form.task}
            useWorktree={form.useWorktree}
            onWorktree={form.chooseWorktree}
            branchName={form.branchName}
            branchEdited={form.branchEdited}
            onBranch={form.editBranch}
            baseBranch={form.baseBranch}
            onBaseBranch={form.setBaseBranch}
          />
          {/* Task prompt */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-text-muted" htmlFor="task-prompt">
              Task · prompt · greeting <span className="text-text-muted">(optional)</span>
            </label>
            <textarea
              ref={textareaRef}
              id="task-prompt"
              value={form.task}
              onChange={(e) => form.setTask(e.target.value)}
              placeholder="Sent to the agent as its first message — a task, a prompt, or just a hello"
              rows={3}
              className="resize-none rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-[10px] text-text-muted">
            {spawnSummary(form.provider, form.useWorktree, form.accessMode, form.selectedSkills)}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-white/5"
            >
              Cancel
            </button>
            <LaunchButton canLaunch={canLaunch} spawning={spawning} onLaunch={handleSpawn} />
          </div>
        </div>
      </div>
    </div>
  );
}

function spawnSummary(
  provider: AgentProvider | undefined,
  useWorktree: boolean,
  accessMode: AgentAccessMode,
  skills: Set<string>,
): string {
  return [
    provider ? `${provider.name}` : "Select an agent",
    useWorktree ? " · worktree" : " · main repo",
    accessMode !== "write" ? ` · ${accessMode}` : "",
    skills.size > 0 ? ` · ${skills.size} skill${skills.size > 1 ? "s" : ""}` : "",
  ].join("");
}

function LaunchButton({
  canLaunch,
  spawning,
  onLaunch,
}: {
  canLaunch: boolean;
  spawning: boolean;
  onLaunch: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!canLaunch}
      onClick={onLaunch}
      className={cn(
        "rounded-lg px-4 py-1.5 text-[11px] font-semibold transition-all",
        canLaunch
          ? "bg-accent text-white hover:bg-accent/90"
          : "bg-bg-tertiary text-text-muted cursor-not-allowed",
      )}
    >
      {spawning ? "Launching..." : "Launch"}
      <span className="ml-1 text-[9px] opacity-60">{editKeys("Cmd+Enter")}</span>
    </button>
  );
}
