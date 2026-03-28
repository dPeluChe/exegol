import { PIPELINE_PRESETS, type PipelineRun, type PipelineTemplate } from "@exegol/shared";
import { cn } from "@exegol/ui";
import {
  CheckCircle,
  GitBranch,
  Loader2,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import {
  useCancelPipelineRun,
  useCreatePipelineTemplate,
  useDeletePipelineRun,
  useDeletePipelineTemplate,
  usePipelineRuns,
  usePipelineTemplates,
  useStartPipelineRun,
} from "../../../hooks/use-trpc-pipeline";

import { PipelineRunView } from "./pipeline/PipelineRunView";
import { PipelineTemplateEditor } from "./pipeline/PipelineTemplateEditor";

type View =
  | { type: "list" }
  | { type: "editor"; template?: PipelineTemplate }
  | { type: "run"; runId: string };

function RunStatusIcon({ status }: { status: PipelineRun["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-3.5 w-3.5 text-green-400" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />;
    case "paused":
      return <Pause className="h-3.5 w-3.5 text-yellow-400" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    default:
      return <div className="h-3.5 w-3.5 rounded-full border border-text-muted/30" />;
  }
}

export function PipelineSection() {
  const { projectId } = useProjectContext();
  const { data: templates } = usePipelineTemplates(projectId);
  const { data: runs } = usePipelineRuns(projectId);
  const createTemplate = useCreatePipelineTemplate();
  const deleteTemplate = useDeletePipelineTemplate();
  const deleteRun = useDeletePipelineRun();
  const startRun = useStartPipelineRun();
  const cancelRun = useCancelPipelineRun();

  const [view, setView] = useState<View>({ type: "list" });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [useWorktree, setUseWorktree] = useState(true);

  const selectedTemplate = templates?.find((t) => t.id === selectedTemplateId);

  if (view.type === "editor") {
    return (
      <PipelineTemplateEditor
        existingId={view.template?.id}
        existingName={view.template?.name}
        existingDescription={view.template?.description}
        existingSteps={view.template?.steps}
        onClose={() => setView({ type: "list" })}
      />
    );
  }

  if (view.type === "run") {
    return <PipelineRunView runId={view.runId} onClose={() => setView({ type: "list" })} />;
  }

  const handleStartRun = () => {
    if (!projectId || !selectedTemplateId) return;
    startRun.mutate(
      {
        templateId: selectedTemplateId,
        projectId,
        task: selectedTemplate?.name || "Pipeline run",
        useWorktree,
      },
      {
        onSuccess: (run) => {
          setView({ type: "run", runId: run.id });
        },
      },
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Start Run Bar */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <select
            value={selectedTemplateId ?? ""}
            onChange={(e) => setSelectedTemplateId(e.target.value || null)}
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
            onClick={handleStartRun}
            disabled={!selectedTemplateId || startRun.isPending}
            className={cn(
              "flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium shrink-0",
              selectedTemplateId
                ? "bg-accent text-white hover:bg-accent/90"
                : "bg-white/5 text-text-muted",
            )}
          >
            <Play className="h-3 w-3" />
            {startRun.isPending ? "Starting..." : "Run"}
          </button>
        </div>
        {/* Step preview for selected template */}
        {selectedTemplate && (
          <div className="mt-2 space-y-1.5">
            {selectedTemplate.description && (
              <p className="text-[10px] text-text-muted/70 italic">
                {selectedTemplate.description}
              </p>
            )}
            {selectedTemplate.steps.map((step, i) => (
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
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Templates Panel */}
        <div className="w-64 shrink-0 border-r border-border">
          <div className="flex items-center justify-between px-3 py-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Templates
            </h4>
            <button
              type="button"
              onClick={() => setView({ type: "editor" })}
              className="rounded p-0.5 text-text-muted hover:bg-white/5 hover:text-text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-0.5 px-1">
            {(!templates || templates.length === 0) && (
              <div className="px-2 py-3 space-y-2">
                <p className="text-center text-[10px] text-text-muted">
                  Get started with a preset:
                </p>
                {PIPELINE_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => {
                      if (!projectId) return;
                      createTemplate.mutate({
                        projectId,
                        name: preset.name,
                        description: preset.description,
                        steps: preset.steps,
                      });
                    }}
                    className="flex w-full items-center gap-2 rounded-lg bg-accent/5 px-3 py-2 text-left hover:bg-accent/10"
                  >
                    <Sparkles className="h-3 w-3 shrink-0 text-accent" />
                    <div>
                      <p className="text-[10px] font-medium text-text-primary">{preset.name}</p>
                      <p className="text-[9px] text-text-muted">{preset.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {templates?.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "group flex items-center justify-between rounded-lg px-3 py-2 hover:bg-white/5",
                  selectedTemplateId === t.id && "bg-accent/10",
                )}
              >
                <button
                  type="button"
                  className="flex-1 text-left"
                  onClick={() => setSelectedTemplateId(t.id)}
                  onDoubleClick={() => setView({ type: "editor", template: t })}
                >
                  <p className="text-[11px] font-medium text-text-primary">{t.name}</p>
                  <p className="text-[9px] text-text-muted">
                    {t.steps.length} step{t.steps.length !== 1 ? "s" : ""}
                    {t.description ? ` — ${t.description}` : ""}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => deleteTemplate.mutate(t.id)}
                  className="hidden shrink-0 text-text-muted hover:text-red-400 group-hover:block"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Runs Panel */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Runs
            </h4>
          </div>
          <div className="space-y-0.5 px-1">
            {(!runs || runs.length === 0) && (
              <p className="px-3 py-4 text-center text-[10px] text-text-muted">
                No pipeline runs yet. Select a template and start one above.
              </p>
            )}
            {runs?.map((r) => (
              <div
                key={r.id}
                className="group flex items-center justify-between rounded-lg px-3 py-2 hover:bg-white/5"
              >
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 text-left"
                  onClick={() => setView({ type: "run", runId: r.id })}
                >
                  <RunStatusIcon status={r.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium text-text-primary">
                      {r.originalTask || "Untitled"}
                    </p>
                    <p className="text-[9px] text-text-muted">
                      Step {r.currentStepIndex + 1} of {r.stepResults.length || "?"} — {r.status}
                      {r.iterationCount > 0 && ` (iter ${r.iterationCount})`}
                    </p>
                  </div>
                </button>
                <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
                  {(r.status === "running" || r.status === "paused") && (
                    <button
                      type="button"
                      onClick={() => cancelRun.mutate(r.id)}
                      className="text-text-muted hover:text-red-400"
                    >
                      <XCircle className="h-3 w-3" />
                    </button>
                  )}
                  {r.status !== "running" && (
                    <button
                      type="button"
                      onClick={() => deleteRun.mutate(r.id)}
                      className="text-text-muted hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
