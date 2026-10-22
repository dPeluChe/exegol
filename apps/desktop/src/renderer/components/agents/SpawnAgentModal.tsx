import type { AgentAccessMode, AgentProvider } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useEnabledProviders } from "../../hooks/use-providers";
import { editKeys } from "../../lib/keymap";
import { Kbd } from "../common/Kbd";
import { AgentSwitcher } from "./AgentSwitcher";
import { SpawnFormBody } from "./SpawnFormBody";
import { useSpawnAgent } from "./use-spawn-agent";
import { canLaunchForm, type SessionChoice, useSpawnForm } from "./use-spawn-form";

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
  /** Start in this branch's worktree (an ended session's place, reused) */
  initialBranch?: string | null;
  /** Start in this folder of the project (a launcher's subfolder) */
  folder?: string;
  /** After the new agent took its pane */
  onSpawned?: (agentId: string) => void;
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
  initialBranch,
  folder,
  onSpawned,
}: SpawnAgentModalProps) {
  // All enabled ones: the switcher lists those not installed last and the form starts on one that is
  const enabledProviders = useEnabledProviders();
  const form = useSpawnForm({
    projectId,
    enabledProviders,
    initialProvider,
    initialTask,
    initialCliType,
    initialSession,
    initialAccessMode,
    initialBranch,
    folder,
  });
  const { spawning, spawn } = useSpawnAgent({ projectId, targetPaneId, onClose, onSpawned });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const canLaunch = canLaunchForm(form, spawning);

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
      <div className="relative z-10 flex max-h-[90vh] w-[480px] max-w-[calc(100vw-2rem)] flex-col [overflow-wrap:anywhere] rounded-xl border border-border bg-bg-primary shadow-2xl">
        {/* Header: the agent, switchable without closing */}
        <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
          <AgentSwitcher
            providers={enabledProviders}
            selectedId={form.providerId}
            onChoose={form.chooseProvider}
            suffix={folder ? `in ${folder.slice(folder.lastIndexOf("/") + 1)}` : undefined}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted hover:bg-white/10 hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          <SpawnFormBody projectId={projectId} form={form} promptRef={textareaRef} />
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
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-white/5"
            >
              Cancel
              <Kbd className="h-4 min-w-4 px-1 text-[9px]">esc</Kbd>
            </button>
            <LaunchButton
              canLaunch={canLaunch}
              spawning={spawning}
              onLaunch={handleSpawn}
              keys={editKeys("Cmd+Enter")}
            />
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

export function LaunchButton({
  canLaunch,
  spawning,
  onLaunch,
  keys,
}: {
  canLaunch: boolean;
  spawning: boolean;
  onLaunch: () => void;
  keys: string;
}) {
  return (
    <button
      type="button"
      disabled={!canLaunch}
      onClick={onLaunch}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[11px] font-semibold transition-all",
        canLaunch
          ? "bg-accent text-white hover:bg-accent/90"
          : "bg-bg-tertiary text-text-muted cursor-not-allowed",
      )}
    >
      {spawning ? "Launching..." : "Launch"}
      <Kbd className="h-4 min-w-4 border-white/30 bg-white/10 px-1 text-[9px] text-current">
        {keys}
      </Kbd>
    </button>
  );
}
