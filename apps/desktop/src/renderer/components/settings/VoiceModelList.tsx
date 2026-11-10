import { Volume2 } from "lucide-react";
import { useModelAction, useVoiceModels } from "../../hooks/use-trpc-models";
import { formatBytes } from "../workspace/sections/resource-format";
import { ModelCard, ModelStatusActions } from "./ModelCard";
import { ReadingNotes } from "./ReadingNotes";
import { useConfirmDeleteModel } from "./use-confirm-delete-model";

/** Settings > Models > Voice: text-to-speech models, apart from the dictation ones */
export function VoiceModels() {
  const { data, isLoading } = useVoiceModels();
  const action = useModelAction();
  const { requestDelete, dialog } = useConfirmDeleteModel();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Volume2 className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Voice</h3>
      </div>
      <p className="text-xs leading-relaxed text-text-muted">
        Reads the Commander's replies aloud, generated on this machine: no text leaves it. Pick the
        voice in Dashboard &gt; Commander.
      </p>
      {isLoading && <p className="text-xs text-text-muted">Loading voices...</p>}
      {data?.map((model) => (
        <ModelCard
          key={model.id}
          status={model.status}
          actions={
            <ModelStatusActions
              model={model}
              busy={action.isPending}
              onAction={(name) => action.mutate({ action: name, id: model.id })}
              onDelete={() => requestDelete(model)}
            />
          }
        >
          <span className="text-sm font-medium text-text-primary">{model.name}</span>
          <p className="mt-0.5 text-xs text-text-secondary">{model.bestFor}</p>
          <p className="mt-1 text-[11px] text-text-muted">
            {model.voices.length} voices · {formatBytes(model.sizeBytes)} download ·{" "}
            {formatBytes(model.installedBytes)} on disk · {model.license}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-text-muted/80">{model.attribution}</p>
        </ModelCard>
      ))}
      <ReadingNotes />
      {dialog}
    </div>
  );
}
