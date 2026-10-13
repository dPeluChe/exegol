import { cn } from "@exegol/ui";
import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";

interface PageDialog {
  id: string;
  paneId: string;
  type: "alert" | "confirm" | "prompt";
  host: string;
  message: string;
  defaultPrompt: string;
  /** The page keeps opening dialogs */
  offerBlock: boolean;
}

const btn =
  "shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/10";

function usePageDialogs(paneId: string) {
  const [dialogs, setDialogs] = useState<PageDialog[]>([]);
  // A pane keeps its id while mounted
  useMountEffect(() => {
    const offOpen = window.api.browser.onPageDialog((d) => {
      if (d.paneId === paneId) setDialogs((list) => [...list, d]);
    });
    const offClosed = window.api.browser.onPageDialogClosed(({ id }) =>
      setDialogs((list) => list.filter((d) => d.id !== id)),
    );
    return () => {
      offOpen();
      offClosed();
    };
  });
  const answer = (id: string, ok: boolean, text?: string) => {
    setDialogs((list) => list.filter((d) => d.id !== id));
    void window.api.browser.answerPageDialog({ id, ok, text }).catch(() => {});
  };
  return { dialog: dialogs[0] ?? null, answer };
}

/** A page's alert / confirm / prompt, inside its pane instead of an app-modal box. The page
 *  stays blocked until it is answered, as in Chrome. No autofocus: it must not take the keys
 *  from the terminal the user is typing in */
export function PageDialogBar({ paneId }: { paneId: string }) {
  const { dialog, answer } = usePageDialogs(paneId);
  if (!dialog) return null;
  return <PageDialogRow key={dialog.id} dialog={dialog} answer={answer} />;
}

function PageDialogRow({
  dialog,
  answer,
}: {
  dialog: PageDialog;
  answer: (id: string, ok: boolean, text?: string) => void;
}) {
  const [text, setText] = useState(dialog.defaultPrompt);
  const ok = () => answer(dialog.id, true, text);
  const cancel = () => answer(dialog.id, false);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") cancel();
    // A focused button already clicks on Enter
    else if (e.key === "Enter" && e.target instanceof HTMLInputElement) ok();
  };
  return (
    <div
      role="alertdialog"
      aria-label={`${dialog.host || "This page"} says`}
      onKeyDown={onKeyDown}
      className="flex shrink-0 items-start gap-2 border-b border-accent/30 bg-accent/10 px-2 py-1.5 text-[11px] text-text-secondary"
    >
      <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-text-primary">{dialog.host || "This page"} says</div>
        {dialog.message && (
          <div className="max-h-24 overflow-auto whitespace-pre-wrap break-words">
            {dialog.message}
          </div>
        )}
        {dialog.offerBlock && (
          <div className="mt-0.5 text-text-muted">
            This page keeps opening dialogs.{" "}
            <button
              type="button"
              className="underline hover:text-text-primary"
              onClick={() => void window.api.browser.blockPageDialogs(dialog.id).catch(() => {})}
            >
              Block dialogs from this page
            </button>
          </div>
        )}
        {dialog.type === "prompt" && (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg-primary px-1.5 py-0.5 text-[11px] text-text-primary outline-none focus:border-accent"
          />
        )}
      </div>
      {dialog.type !== "alert" && (
        <button type="button" className={cn(btn, "border-border")} onClick={cancel}>
          Cancel
        </button>
      )}
      <button type="button" className={cn(btn, "border-accent/40 text-accent")} onClick={ok}>
        OK
      </button>
    </div>
  );
}
