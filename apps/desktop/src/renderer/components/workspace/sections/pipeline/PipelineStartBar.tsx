import type { PipelineTemplate } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { AlertTriangle, GitBranch, Play } from "lucide-react";
import type { PipelineLauncher } from "./use-pipeline-launcher";

export function PipelineStartBar({
  templates,
  launcher,
}: {
  templates: PipelineTemplate[] | undefined;
  launcher: PipelineLauncher;
}) {
  const {
    selectedTemplateId,
    setSelectedTemplateId,
    selectedTemplate,
    useWorktree,
    setUseWorktree,
    task,
    setTask,
    gitWarning,
    canRun,
    isStarting,
    handleStartRun,
  } = launcher;

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <select
          value={selectedTemplateId ?? ""}
          onChange={(e) => setSelectedTemplateId(e.target.value || null)}
          aria-label="Pipeline template"
          className="flex-1 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-[11px] text-text-primary focus:border-accent focus:outline-none"
        >
          <option value="">Select pipeline...</option>
          {templates?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <label
          className="flex items-center gap-1.5 cursor-pointer shrink-0"
          htmlFor="pipeline-worktree"
        >
          <input
            type="checkbox"
            id="pipeline-worktree"
            checked={useWorktree}
            onChange={(e) => setUseWorktree(e.target.checked)}
            className="h-3 w-3 rounded border-border accent-accent"
          />
          <GitBranch className="h-3 w-3 text-text-muted" />
          <span className="text-[10px] text-text-muted">Worktree</span>
        </label>
        <button
          type="button"
          onClick={() => handleStartRun()}
          disabled={!canRun || isStarting}
          className={cn(
            "flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium shrink-0",
            canRun ? "bg-accent text-white hover:bg-accent/90" : "bg-white/5 text-text-muted",
          )}
        >
          <Play className="h-3 w-3" />
          {isStarting ? "Starting..." : "Run"}
        </button>
      </div>
      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        aria-label="Pipeline task"
        placeholder="What should this pipeline do? (becomes {{task}} in every step)"
        rows={2}
        className="mt-2 w-full resize-y rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
      />
      {gitWarning && (
        <GitSyncWarning
          message={gitWarning}
          onRunWithoutWorktree={launcher.runWithoutWorktree}
          onDismiss={launcher.dismissGitWarning}
        />
      )}
      {selectedTemplate && <TemplateStepPreview template={selectedTemplate} />}
    </div>
  );
}

function GitSyncWarning({
  message,
  onRunWithoutWorktree,
  onDismiss,
}: {
  message: string;
  onRunWithoutWorktree: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
      <span className="flex-1 text-[10px] text-yellow-300">{message}</span>
      <button
        type="button"
        onClick={onRunWithoutWorktree}
        className="shrink-0 rounded px-2 py-0.5 text-[9px] text-text-muted hover:bg-white/10"
      >
        Run without worktree
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded px-2 py-0.5 text-[9px] text-yellow-400 hover:bg-yellow-500/20"
      >
        Dismiss
      </button>
    </div>
  );
}

function TemplateStepPreview({ template }: { template: PipelineTemplate }) {
  return (
    <div className="mt-2 space-y-1.5">
      {template.description && (
        <p className="text-[10px] text-text-muted/70 italic">{template.description}</p>
      )}
      {template.steps.map((step, i) => (
        <div
          key={step.label || `preview-${i}`}
          className="flex items-start gap-2 rounded bg-white/[0.02] px-2 py-1.5"
        >
          <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-medium text-text-secondary">
            {i + 1}. {step.cliType}
            <span className="ml-1 text-text-muted">({step.role})</span>
          </span>
          <p className="text-[10px] text-text-muted leading-relaxed truncate">
            {step.promptTemplate || `Default ${step.role} template`}
          </p>
        </div>
      ))}
    </div>
  );
}
