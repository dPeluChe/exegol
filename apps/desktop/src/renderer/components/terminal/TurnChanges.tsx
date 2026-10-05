import type { TurnChanges } from "@exegol/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { FileDiff, Undo2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useLatestTurn, useTurnDiff, useUndoTurn } from "../../hooks/use-trpc-scoring";
import { ConfirmDialog } from "../common/ConfirmDialog";
import type { QuietAgent } from "../common/QuietControls";
import { DiffFileView } from "../workspace/sections/diff/DiffFileView";
import { parseUnifiedDiff } from "../workspace/sections/diff/diff-parser";
import { useExpandedDiffFiles } from "../workspace/sections/diff/use-expanded-diff-files";

const SHOWN_NAMES = 5;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function undoDescription(turn: TurnChanges): string {
  const names = turn.files.slice(0, SHOWN_NAMES).map((f) => f.path);
  const more = turn.files.length - names.length;
  return (
    `Restores ${plural(turn.files.length, "file")} to how they were before turn ${turn.turnIndex}: ` +
    `${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}. ` +
    "Edits made since the turn ended are reverted too. Exegol commits the restored folder on " +
    "your branch and keeps a safety snapshot in the Oplog, so this can be undone as well."
  );
}

/** T200.5: "N files changed" after a turn: the turn's diff, and Undo turn */
export function TurnChangesChip({ agent }: { agent: QuietAgent }) {
  const { data: turn } = useLatestTurn(agent.id);
  const [open, setOpen] = useState(false);
  if (!turn) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-1 rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent hover:bg-accent/20"
        title={`What turn ${turn.turnIndex} changed`}
      >
        <FileDiff className="h-2.5 w-2.5" />
        {plural(turn.files.length, "file")} changed
      </button>
      {open && (
        <TurnDiffDialog
          turn={turn}
          busy={agent.status === "running"}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function TurnDiffDialog({
  turn,
  busy,
  onClose,
}: {
  turn: TurnChanges;
  busy: boolean;
  onClose: () => void;
}) {
  const { data: rawDiff, isLoading, error } = useTurnDiff(turn);
  const files = useMemo(() => parseUnifiedDiff(rawDiff ?? ""), [rawDiff]);
  const { expandedFiles, toggleFile } = useExpandedDiffFiles(rawDiff, files);
  const undo = useUndoTurn();
  const [confirming, setConfirming] = useState(false);

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-[8%] z-50 flex max-h-[84vh] w-full max-w-3xl -translate-x-1/2 flex-col gap-3 rounded-xl border border-border bg-bg-secondary p-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold text-text-primary">
              Turn {turn.turnIndex}: {plural(turn.files.length, "file")} changed
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded p-1 text-text-muted hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            The diff of this agent turn, with the option to undo it
          </Dialog.Description>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {isLoading ? (
              <p className="text-[11px] text-text-muted">Loading diff...</p>
            ) : error ? (
              <p className="text-[11px] text-error">{(error as Error).message}</p>
            ) : (
              files.map((file) => (
                <DiffFileView
                  key={file.newPath}
                  file={file}
                  viewMode="unified"
                  collapsed={!expandedFiles.has(file.newPath)}
                  onToggle={() => toggleFile(file.newPath)}
                  projectId={null}
                />
              ))
            )}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy || undo.isPending}
              onClick={() => setConfirming(true)}
              className="flex items-center gap-1 rounded border border-border px-3 py-1 text-[11px] text-error hover:bg-error/10 disabled:opacity-50"
              title={busy ? "The agent is working: undo once its turn ends" : undefined}
            >
              <Undo2 className="h-3 w-3" />
              Undo turn
            </button>
          </div>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Undo turn ${turn.turnIndex}?`}
            description={undoDescription(turn)}
            confirmLabel="Undo turn"
            variant="destructive"
            onConfirm={() => undo.mutate(turn, { onSuccess: onClose })}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
