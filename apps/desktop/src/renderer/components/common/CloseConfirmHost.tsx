import { useCloseConfirmStore } from "../../stores/close-confirm";
import { ConfirmDialog } from "./ConfirmDialog";

/** The close confirmation asked by `confirmClosePanes` (Cmd+W, pane X, pane menu, tab close).
 *  Enter closes, Esc keeps it open */
export function CloseConfirmHost() {
  const request = useCloseConfirmStore((s) => s.request);
  const answer = useCloseConfirmStore((s) => s.answer);
  return (
    <ConfirmDialog
      open={!!request}
      onOpenChange={(open) => !open && answer(false)}
      title={request?.title ?? ""}
      description={
        <span className="flex flex-col gap-1">
          {request?.lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      }
      confirmLabel="Close"
      variant="destructive"
      autoFocusConfirm
      onConfirm={() => answer(true)}
    />
  );
}
