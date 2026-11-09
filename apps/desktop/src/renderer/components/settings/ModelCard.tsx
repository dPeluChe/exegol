import type { ModelListItem, ModelStatus } from "@exegol/shared";
import { Download, RotateCcw, Star, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { formatBytes } from "../workspace/sections/resource-format";
import { SMALL_BUTTON } from "./settings-ui";

export type RowAction = "download" | "cancel" | "setDefault";

/** A model's card: details beside its actions, the download bar and a failure line under them */
export function ModelCard({
  status,
  actions,
  children,
}: {
  status: ModelStatus;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">{actions}</div>
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

/** Download, progress, cancel, retry and delete; "Set as default" only where a default applies */
export function ModelStatusActions({
  model,
  busy,
  onAction,
  onDelete,
}: {
  model: Pick<ModelListItem, "status" | "engineAvailable" | "sizeBytes"> & { isDefault?: boolean };
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
            {model.isDefault === false && (
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
