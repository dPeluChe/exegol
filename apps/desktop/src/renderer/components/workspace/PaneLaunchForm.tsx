import type { AgentAccessMode, AgentProvider } from "@exegol/shared";
import { ArrowLeft } from "lucide-react";
import { useRef } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useEnabledProviders } from "../../hooks/use-providers";
import { editKeys } from "../../lib/keymap";
import { launchFormKey } from "../../lib/launcher";
import { AgentSwitcher } from "../agents/AgentSwitcher";
import { LaunchButton } from "../agents/SpawnAgentModal";
import { SpawnFormBody } from "../agents/SpawnFormBody";
import { useSpawnAgent } from "../agents/use-spawn-agent";
import { canLaunchForm, type SessionChoice, useSpawnForm } from "../agents/use-spawn-form";
import { Kbd } from "../common/Kbd";

/** T204: a picked agent turns the empty pane into its launch form, in the launcher's folder.
 *  Esc goes back to the launcher; Enter (Shift+Enter a new line) or Cmd+Enter launches */
export function PaneLaunchForm({
  projectId,
  paneId,
  provider,
  session,
  accessMode,
  folder,
  folderName,
  onBack,
}: {
  projectId: string;
  paneId: string;
  provider: AgentProvider;
  session: SessionChoice;
  accessMode: AgentAccessMode;
  /** The subfolder it starts in; undefined is the project root */
  folder: string | undefined;
  folderName: string;
  onBack: () => void;
}) {
  const enabledProviders = useEnabledProviders();
  const form = useSpawnForm({
    projectId,
    enabledProviders,
    initialProvider: provider,
    initialCliType: provider.id,
    initialSession: session,
    initialAccessMode: accessMode,
    folder,
  });
  const { spawning, spawn } = useSpawnAgent({ projectId, targetPaneId: paneId, onClose: onBack });
  const promptRef = useRef<HTMLTextAreaElement>(null);
  useMountEffect(() => promptRef.current?.focus());

  const canLaunch = canLaunchForm(form, spawning);
  const launch = () => {
    if (canLaunch) spawn(form);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = launchFormKey(e.nativeEvent, (e.target as HTMLElement).tagName);
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    if (key === "back") onBack();
    else launch();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the form's keys (Esc back, Enter launch)
    <div
      className="my-auto flex w-full max-w-md shrink-0 flex-col gap-3 rounded-xl border border-border bg-bg-primary p-4 shadow-2xl"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onBack}
          title="Back to the launcher (Esc)"
          aria-label="Back to the launcher"
          className="mt-0.5 flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-text-muted hover:bg-white/5 hover:text-text-secondary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <AgentSwitcher
          providers={enabledProviders}
          selectedId={form.providerId}
          onChoose={form.chooseProvider}
          suffix={`in ${folderName}`}
        />
      </div>
      <SpawnFormBody
        projectId={projectId}
        form={form}
        promptRef={promptRef}
        promptPlaceholder={`Sent as its first message. Enter launches (${editKeys("Cmd+Enter")} anywhere), Shift+Enter for a new line`}
      />
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-white/5"
        >
          Cancel
          <Kbd className="h-4 min-w-4 px-1 text-[9px]">esc</Kbd>
        </button>
        <LaunchButton canLaunch={canLaunch} spawning={spawning} onLaunch={launch} keys="↵" />
      </div>
    </div>
  );
}
