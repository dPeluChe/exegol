import { PIPELINE_PRESETS, type PipelineTemplate } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useCreatePipelineTemplate } from "../../../../hooks/use-trpc-pipeline";

export function PipelineTemplateList({
  projectId,
  templates,
  selectedTemplateId,
  onSelect,
  onEdit,
  onDelete,
}: {
  projectId: string | null;
  templates: PipelineTemplate[] | undefined;
  selectedTemplateId: string | null;
  onSelect: (id: string) => void;
  onEdit: (template?: PipelineTemplate) => void;
  onDelete: (template: PipelineTemplate) => void;
}) {
  return (
    <div className="w-64 shrink-0 border-r border-border">
      <div className="flex items-center justify-between px-3 py-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Templates
        </h4>
        <button
          type="button"
          onClick={() => onEdit()}
          aria-label="New template"
          className="rounded p-0.5 text-text-muted hover:bg-white/5 hover:text-text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-0.5 px-1">
        {(!templates || templates.length === 0) && <PipelinePresetPicker projectId={projectId} />}
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
              onClick={() => onSelect(t.id)}
              onDoubleClick={() => onEdit(t)}
            >
              <p className="text-[11px] font-medium text-text-primary">{t.name}</p>
              <p className="text-[9px] text-text-muted">
                {t.steps.length} step{t.steps.length !== 1 ? "s" : ""}
                {t.description ? ` — ${t.description}` : ""}
              </p>
            </button>
            <button
              type="button"
              onClick={() => onDelete(t)}
              aria-label={`Delete template ${t.name}`}
              className="hidden shrink-0 text-text-muted hover:text-red-400 group-hover:block"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelinePresetPicker({ projectId }: { projectId: string | null }) {
  const createTemplate = useCreatePipelineTemplate();
  return (
    <div className="px-2 py-3 space-y-2">
      <p className="text-center text-[10px] text-text-muted">Get started with a preset:</p>
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
  );
}
