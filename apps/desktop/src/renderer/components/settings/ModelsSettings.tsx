import type { ModelListItem } from "@exegol/shared";
import { AlertTriangle, AudioLines, Download, RotateCcw, Star, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useModelAction, useModels } from "../../hooks/use-trpc-models";
import { SEMANTIC_BADGE } from "../../lib/semantic-colors";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { formatBytes } from "../workspace/sections/resource-format";
import { SMALL_BUTTON } from "./settings-ui";
import { useConfirmDeleteModel } from "./use-confirm-delete-model";

type RowAction = "download" | "cancel" | "setDefault";
type LicensedAction = "download" | "setDefault";

const BADGE = "rounded-full px-2 py-0.5 text-[10px]";

export function ModelsSettings() {
  const { data: models, isLoading } = useModels();
  const action = useModelAction();
  const { requestDelete, dialog: deleteDialog } = useConfirmDeleteModel();
  const [licenseCheck, setLicenseCheck] = useState<{
    model: ModelListItem;
    action: LicensedAction;
  } | null>(null);

  const run = (model: ModelListItem, name: RowAction) => {
    if (name !== "cancel" && model.commercialUse === false) {
      setLicenseCheck({ model, action: name });
      return;
    }
    action.mutate({ action: name, id: model.id });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <AudioLines className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Speech models</h3>
      </div>
      <p className="text-xs leading-relaxed text-text-muted">
        Local speech-to-text models for voice dictation. They run on this machine: audio never
        leaves it. Downloads are checked against a pinned SHA-256 before they are unpacked into
        ~/.exegol/models.
      </p>
      {isLoading && <p className="text-xs text-text-muted">Loading models...</p>}
      <div className="space-y-2">
        {models?.map((model) => (
          <ModelRow
            key={model.id}
            model={model}
            busy={action.isPending}
            onAction={(name) => run(model, name)}
            onDelete={() => requestDelete(model)}
          />
        ))}
      </div>
      {deleteDialog}
      <ConfirmDialog
        open={licenseCheck !== null}
        onOpenChange={(open) => !open && setLicenseCheck(null)}
        title="Non-commercial license"
        description={
          licenseCheck
            ? `${licenseCheck.model.name} is under the ${licenseCheck.model.license}: you may not use it for commercial work. ${licenseCheck.action === "download" ? "Download it anyway?" : "Make it the default anyway?"}`
            : ""
        }
        confirmLabel={licenseCheck?.action === "download" ? "Download" : "Set as default"}
        onConfirm={() =>
          licenseCheck &&
          action.mutate({
            action: licenseCheck.action,
            id: licenseCheck.model.id,
            acceptNonCommercial: true,
          })
        }
      />
    </div>
  );
}

function languagesLabel(model: ModelListItem): string {
  if (model.languageSummary) return model.languageSummary;
  if (model.languages.length <= 3) return model.languages.join(", ").toUpperCase();
  return `${model.languages.length} languages`;
}

function ModelRow({
  model,
  busy,
  onAction,
  onDelete,
}: {
  model: ModelListItem;
  busy: boolean;
  onAction: (action: RowAction) => void;
  onDelete: () => void;
}) {
  const { status } = model;
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{model.name}</span>
            {model.isDefault && (
              <span className={`${BADGE} bg-accent/15 text-accent`}>Default</span>
            )}
            {model.kind === "streaming" && (
              <span className={`${BADGE} ${SEMANTIC_BADGE.info}`}>Streaming</span>
            )}
            {!model.engineAvailable && (
              <span className={`${BADGE} ${SEMANTIC_BADGE.muted}`}>Coming</span>
            )}
            {model.commercialUse === false && (
              <span
                className={`${BADGE} ${SEMANTIC_BADGE.warning} flex items-center gap-1`}
                title={model.license}
              >
                <AlertTriangle className="h-2.5 w-2.5" /> Non-commercial
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-text-secondary">{model.bestFor}</p>
          <p
            className="mt-1 text-[11px] text-text-muted"
            title={model.languages.join(", ") || undefined}
          >
            {languagesLabel(model)} · {formatBytes(model.sizeBytes)} download ·{" "}
            {formatBytes(model.installedBytes)} on disk · {model.license}
          </p>
          {model.notes && <p className="mt-1 text-[11px] text-text-muted">{model.notes}</p>}
          {/* CC-BY and community licenses require the credit next to the model */}
          <p className="mt-1 text-[10px] leading-relaxed text-text-muted/80">{model.attribution}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <ModelStatusActions model={model} busy={busy} onAction={onAction} onDelete={onDelete} />
        </div>
      </div>
      {status.state === "downloading" && (
        <div className="mt-2 h-1 overflow-hidden rounded bg-bg-tertiary">
          <div
            className="h-full bg-accent transition-[width]"
            style={{ width: `${Math.min(100, (status.receivedBytes / status.totalBytes) * 100)}%` }}
          />
        </div>
      )}
      {status.state === "failed" && (
        <p className="mt-2 text-[11px] text-error">Failed: {status.error}</p>
      )}
    </div>
  );
}

function ModelStatusActions({
  model,
  busy,
  onAction,
  onDelete,
}: {
  model: ModelListItem;
  busy: boolean;
  onAction: (action: RowAction) => void;
  onDelete: () => void;
}) {
  const { status } = model;
  if (!model.engineAvailable) return null;
  switch (status.state) {
    case "downloading":
      return (
        <>
          <span className="text-[11px] text-text-muted">
            {Math.floor((status.receivedBytes / status.totalBytes) * 100)}% of{" "}
            {formatBytes(status.totalBytes)}
          </span>
          <button type="button" className={SMALL_BUTTON} onClick={() => onAction("cancel")}>
            <X className="h-3 w-3" /> Cancel
          </button>
        </>
      );
    case "verifying":
    case "extracting":
      return (
        <>
          <span className="text-[11px] text-text-muted">
            {status.state === "verifying" ? "Verifying..." : "Unpacking..."}
          </span>
          <button type="button" className={SMALL_BUTTON} onClick={() => onAction("cancel")}>
            <X className="h-3 w-3" /> Cancel
          </button>
        </>
      );
    case "ready":
      return (
        <>
          <span className="text-[11px] text-success">Ready</span>
          <div className="flex gap-1.5">
            {!model.isDefault && (
              <button
                type="button"
                className={SMALL_BUTTON}
                disabled={busy}
                onClick={() => onAction("setDefault")}
              >
                <Star className="h-3 w-3" /> Set as default
              </button>
            )}
            <button type="button" className={SMALL_BUTTON} onClick={onDelete}>
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          </div>
        </>
      );
    case "failed":
      return (
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={busy}
          onClick={() => onAction("download")}
        >
          <RotateCcw className="h-3 w-3" /> Retry
        </button>
      );
    default:
      return (
        <>
          <button
            type="button"
            className={SMALL_BUTTON}
            disabled={busy}
            onClick={() => onAction("download")}
          >
            <Download className="h-3 w-3" /> {status.partialBytes > 0 ? "Resume" : "Download"}
          </button>
          {status.partialBytes > 0 && (
            <span className="text-[10px] text-text-muted">
              {formatBytes(status.partialBytes)} of {formatBytes(model.sizeBytes)}
            </span>
          )}
        </>
      );
  }
}
