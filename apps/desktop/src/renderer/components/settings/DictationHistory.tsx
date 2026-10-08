import { Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import { useDictationHistory, useDictationHistoryAction } from "../../hooks/use-trpc-dictation";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { SMALL_BUTTON } from "./settings-ui";

const ICON_BUTTON =
  "flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-bg-tertiary hover:text-text-primary";

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** The last dictations: copy again (paste it where it goes: this window cannot see the pane), delete */
export function DictationHistory() {
  const { data: items, isLoading } = useDictationHistory();
  const action = useDictationHistoryAction();
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] text-text-muted">
          {items?.length ? `${items.length} recent` : ""}
        </span>
        {!!items?.length && (
          <button type="button" className={SMALL_BUTTON} onClick={() => setConfirmClear(true)}>
            <Trash2 className="h-3 w-3" />
            Clear all
          </button>
        )}
      </div>
      {isLoading && <p className="text-xs text-text-muted">Loading...</p>}
      {items?.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-text-muted">
          Nothing dictated yet
        </p>
      )}
      <ul className="space-y-1.5">
        {items?.map((item) => (
          <li
            key={item.id}
            className="group flex items-start gap-3 rounded-xl border border-border bg-bg-secondary px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap break-words text-xs text-text-primary">
                {item.text}
              </p>
              <p className="mt-0.5 text-[10px] text-text-muted">
                {when(item.createdAt)} · {Math.round(item.durationMs / 1000)}s · {item.targetKind}
              </p>
            </div>
            <div className="flex shrink-0 gap-0.5">
              <button
                type="button"
                title="Copy"
                aria-label="Copy"
                className={ICON_BUTTON}
                onClick={() => action.mutate({ action: "copyHistory", id: item.id })}
              >
                <Copy className="h-3 w-3" />
              </button>
              <button
                type="button"
                title="Delete"
                aria-label="Delete"
                className={ICON_BUTTON}
                onClick={() => action.mutate({ action: "deleteHistory", id: item.id })}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear dictation history"
        description="Every saved dictation is deleted. This cannot be undone."
        confirmLabel="Clear all"
        onConfirm={() => action.mutate({ action: "clearHistory" })}
      />
    </div>
  );
}
