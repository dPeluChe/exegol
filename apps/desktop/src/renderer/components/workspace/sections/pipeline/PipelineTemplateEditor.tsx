import type { AgentProvider } from "@exegol/shared";
import { AGENT_ACCESS_MODES, PIPELINE_STEP_ROLES, type PipelineStepDef } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { GripVertical, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useProjectContext } from "../../../../contexts/ProjectContext";
import {
  useCreatePipelineTemplate,
  useUpdatePipelineTemplate,
} from "../../../../hooks/use-trpc-pipeline";
import { trpcInvoke } from "../../../../lib/trpc-client";

function emptyStep(defaultCliType = "claude-code"): PipelineStepDef {
  return {
    label: "",
    cliType: defaultCliType,
    role: "implement",
    promptTemplate: "",
  };
}

export function PipelineTemplateEditor({
  existingId,
  existingName,
  existingDescription,
  existingSteps,
  onClose,
}: {
  existingId?: string;
  existingName?: string;
  existingDescription?: string;
  existingSteps?: PipelineStepDef[];
  onClose: () => void;
}) {
  const { projectId } = useProjectContext();
  const { data: enabledProviders } = useQuery({
    queryKey: ["enabledProviders"],
    queryFn: () => trpcInvoke<AgentProvider[]>("agents.listEnabledProviders"),
    staleTime: 30_000,
  });
  const cliOptions = (enabledProviders ?? []).map((p) => p.id);
  const [name, setName] = useState(existingName ?? "");
  const [description, setDescription] = useState(existingDescription ?? "");
  const [steps, setSteps] = useState<PipelineStepDef[]>(
    existingSteps ?? [emptyStep(), emptyStep()],
  );

  const createMutation = useCreatePipelineTemplate();
  const updateMutation = useUpdatePipelineTemplate();
  const isEdit = !!existingId;

  const handleSave = () => {
    if (!projectId || !name.trim() || steps.length === 0) return;

    // Ensure all steps have labels
    const cleanSteps = steps.map((s, i) => ({
      ...s,
      label: s.label.trim() || `Step ${i + 1}`,
    }));

    if (isEdit) {
      updateMutation.mutate(
        { id: existingId, name, description, steps: cleanSteps },
        { onSuccess: onClose },
      );
    } else {
      createMutation.mutate(
        { projectId, name, description, steps: cleanSteps },
        { onSuccess: onClose },
      );
    }
  };

  const updateStep = (index: number, patch: Partial<PipelineStepDef>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const addStep = () => {
    setSteps((prev) => [...prev, emptyStep()]);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary">
          {isEdit ? "Edit Template" : "New Pipeline Template"}
        </h3>
        <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* Name */}
        <div>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: input is sibling */}
          <label className="mb-1 block text-[10px] font-medium text-text-muted">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Implement + Review Loop"
            className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs text-text-primary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
          />
        </div>

        {/* Description */}
        <div>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: input is sibling */}
          <label className="mb-1 block text-[10px] font-medium text-text-muted">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs text-text-primary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
          />
        </div>

        {/* Steps */}
        <div>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: decorative label */}
          <label className="mb-2 block text-[10px] font-medium text-text-muted">
            Steps ({steps.length})
          </label>
          <div className="space-y-3">
            {steps.map((step, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: steps have no stable id, index is fine for non-reorderable list
                key={i}
                className="rounded-lg border border-border bg-bg-secondary p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-3 w-3 text-text-muted/40" />
                    <span className="text-[10px] font-medium text-text-muted">Step {i + 1}</span>
                  </div>
                  {steps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeStep(i)}
                      className="text-text-muted hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={step.label}
                    onChange={(e) => updateStep(i, { label: e.target.value })}
                    placeholder="Label"
                    className="rounded border border-border bg-bg-primary px-2 py-1.5 text-[11px] text-text-primary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
                  />
                  <select
                    value={step.cliType}
                    onChange={(e) => updateStep(i, { cliType: e.target.value })}
                    className="rounded border border-border bg-bg-primary px-2 py-1.5 text-[11px] text-text-primary focus:border-accent focus:outline-none"
                  >
                    {cliOptions.map((cli) => (
                      <option key={cli} value={cli}>
                        {cli}
                      </option>
                    ))}
                  </select>
                  <select
                    value={step.role}
                    onChange={(e) =>
                      updateStep(i, { role: e.target.value as PipelineStepDef["role"] })
                    }
                    className="rounded border border-border bg-bg-primary px-2 py-1.5 text-[11px] text-text-primary focus:border-accent focus:outline-none"
                  >
                    {PIPELINE_STEP_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-2 flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
                    <input
                      type="checkbox"
                      checked={step.allowFailure ?? false}
                      onChange={(e) => updateStep(i, { allowFailure: e.target.checked })}
                      className="h-3 w-3 rounded"
                    />
                    Allow failure
                  </label>
                  <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
                    Mode:
                    <select
                      value={step.accessMode ?? "write"}
                      onChange={(e) =>
                        updateStep(i, {
                          accessMode: e.target.value as PipelineStepDef["accessMode"],
                        })
                      }
                      className="rounded border border-border bg-bg-primary px-1.5 py-0.5 text-[10px] text-text-primary focus:outline-none"
                    >
                      {AGENT_ACCESS_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
                    Loop back to:
                    <select
                      value={step.loopBackTo ?? -1}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        updateStep(i, { loopBackTo: val >= 0 ? val : undefined });
                      }}
                      className="rounded border border-border bg-bg-primary px-1.5 py-0.5 text-[10px] text-text-primary focus:outline-none"
                    >
                      <option value={-1}>None</option>
                      {steps.map((_, si) =>
                        si !== i ? (
                          // biome-ignore lint/suspicious/noArrayIndexKey: index is the value
                          <option key={`loop-${si}`} value={si}>
                            Step {si + 1}
                          </option>
                        ) : null,
                      )}
                    </select>
                  </label>
                </div>

                <textarea
                  value={step.promptTemplate}
                  onChange={(e) => updateStep(i, { promptTemplate: e.target.value })}
                  placeholder="Custom prompt template (leave empty for role default). Variables: {{task}}, {{diff}}, {{previousOutput}}, {{iteration}}"
                  className="mt-2 w-full rounded border border-border bg-bg-primary px-2 py-1.5 text-[10px] text-text-primary placeholder:text-text-muted/40 focus:border-accent focus:outline-none"
                  rows={2}
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addStep}
            className="mt-2 flex items-center gap-1 rounded-lg bg-white/5 px-3 py-1.5 text-[10px] text-text-muted hover:bg-white/10 hover:text-text-primary"
          >
            <Plus className="h-3 w-3" /> Add Step
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!name.trim() || steps.length === 0}
          className={cn(
            "rounded-lg px-4 py-1.5 text-xs font-medium",
            name.trim() && steps.length > 0
              ? "bg-accent text-white hover:bg-accent/90"
              : "bg-white/5 text-text-muted",
          )}
        >
          {isEdit ? "Update" : "Create"}
        </button>
      </div>
    </div>
  );
}
