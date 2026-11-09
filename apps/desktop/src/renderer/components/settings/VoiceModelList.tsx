import type { VoiceModelListItem } from "@exegol/shared";
import { Download, RotateCcw, Trash2, Volume2, X } from "lucide-react";
import { useModelAction, useVoiceModels } from "../../hooks/use-trpc-models";
import { formatBytes } from "../workspace/sections/resource-format";
import { SMALL_BUTTON } from "./settings-ui";
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
        <VoiceRow
          key={model.id}
          model={model}
          busy={action.isPending}
          onAction={(name) => action.mutate({ action: name, id: model.id })}
          onDelete={() => requestDelete(model)}
        />
      ))}
      {dialog}
    </div>
  );
}

function VoiceRow({
  model,
  busy,
  onAction,
  onDelete,
}: {
  model: VoiceModelListItem;
  busy: boolean;
  onAction: (action: "download" | "cancel") => void;
  onDelete: () => void;
}) {
  const { status } = model;
  const working =
    status.state === "downloading" || status.state === "verifying" || status.state === "extracting";
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-text-primary">{model.name}</span>
          <p className="mt-0.5 text-xs text-text-secondary">{model.bestFor}</p>
          <p className="mt-1 text-[11px] text-text-muted">
            {model.voices.length} voices · {formatBytes(model.sizeBytes)} download ·{" "}
            {formatBytes(model.installedBytes)} on disk · {model.license}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-text-muted/80">{model.attribution}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {status.state === "ready" && (
            <>
              <span className="text-[11px] text-success">Ready</span>
              <button type="button" className={SMALL_BUTTON} onClick={onDelete}>
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </>
          )}
          {working && (
            <>
              <span className="text-[11px] text-text-muted">
                {status.state === "downloading"
                  ? `${Math.floor((status.receivedBytes / status.totalBytes) * 100)}% of ${formatBytes(status.totalBytes)}`
                  : status.state === "verifying"
                    ? "Verifying..."
                    : "Unpacking..."}
              </span>
              <button type="button" className={SMALL_BUTTON} onClick={() => onAction("cancel")}>
                <X className="h-3 w-3" /> Cancel
              </button>
            </>
          )}
          {(status.state === "not_downloaded" || status.state === "failed") && (
            <button
              type="button"
              className={SMALL_BUTTON}
              disabled={busy}
              onClick={() => onAction("download")}
            >
              {status.state === "failed" ? (
                <RotateCcw className="h-3 w-3" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {status.state === "failed"
                ? "Retry"
                : status.partialBytes > 0
                  ? "Resume"
                  : "Download"}
            </button>
          )}
        </div>
      </div>
      {status.state === "failed" && (
        <p className="mt-2 text-[11px] text-error">Failed: {status.error}</p>
      )}
    </div>
  );
}
