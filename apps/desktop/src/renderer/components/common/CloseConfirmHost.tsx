import { useEffect } from "react";
import { useCloseConfirmStore } from "../../stores/close-confirm";
import { ConfirmDialog } from "./ConfirmDialog";

/** The close confirmation asked by `confirmCloseTarget` (Cmd+W, pane X, pane menu, tab close).
 *  Cancel has the focus; Esc and a click outside cancel */
export function CloseConfirmHost() {
  const request = useCloseConfirmStore((s) => s.request);
  const answer = useCloseConfirmStore((s) => s.answer);
  const open = !!request;
  // Esc cancels even when a key handler below (a terminal, a capture listener) would eat it
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      useCloseConfirmStore.getState().answer(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);
  return (
    <ConfirmDialog
      open={open}
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
      autoFocusCancel
      onConfirm={() => answer(true)}
    />
  );
}
