import type { Ref } from "react";
import { useRecheckProviders } from "../../hooks/use-providers";
import { ModelChoice } from "./ModelPicker";
import { AccessModePicker, InstallHint, SkillPicker } from "./SpawnOptions";
import { SpawnSessionPicker } from "./SpawnSessionPicker";
import { SpawnWorkLocation } from "./SpawnWorkLocation";
import type { SpawnForm } from "./use-spawn-form";

/** The launch choices under the agent: shared by the Launch Agent modal and the pane's form */
export function SpawnFormBody({
  projectId,
  form,
  promptRef,
  promptPlaceholder = "Sent to the agent as its first message: a task, a prompt, or just a hello",
}: {
  projectId: string;
  form: SpawnForm;
  promptRef?: Ref<HTMLTextAreaElement>;
  promptPlaceholder?: string;
}) {
  const recheck = useRecheckProviders();
  const notInstalled = form.provider?.installed === false;
  return (
    <>
      {notInstalled && form.provider && (
        <InstallHint provider={form.provider} projectId={projectId} onRecheck={recheck} />
      )}
      <ModelChoice
        key={form.providerId}
        providerId={form.providerId}
        model={form.model}
        onModel={form.setModel}
        roles={form.modelRoles}
        onRole={form.setModelRole}
        onPreset={form.applyPreset}
      />
      <SpawnSessionPicker
        projectId={projectId}
        providerId={form.providerId}
        providerName={form.provider?.name}
        resumeFlag={form.provider?.capabilities?.resumeFlag}
        useWorktree={form.useWorktree}
        folder={form.folder}
        session={form.session}
        onSession={form.chooseSession}
        localSessionId={form.localSessionId}
        onLocalSession={form.chooseLocalSession}
        name={form.name}
        onName={form.setName}
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
        folder={form.folder}
        useWorktree={form.useWorktree}
        onWorktree={form.chooseWorktree}
        branchName={form.branchName}
        branchEdited={form.branchEdited}
        onBranch={form.editBranch}
        baseBranch={form.baseBranch}
        onBaseBranch={form.setBaseBranch}
      />
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-text-muted" htmlFor="task-prompt">
          Task · prompt · greeting <span className="text-text-muted">(optional)</span>
        </label>
        <textarea
          ref={promptRef}
          id="task-prompt"
          value={form.task}
          onChange={(e) => form.setTask(e.target.value)}
          placeholder={promptPlaceholder}
          rows={3}
          className="resize-none rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
        />
      </div>
    </>
  );
}
