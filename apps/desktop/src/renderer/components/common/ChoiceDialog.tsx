import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, useRef } from "react";

export interface Choice {
  label: string;
  /** Absent: the dialog only closes */
  run?: () => void;
  kind?: "muted" | "plain" | "primary";
  /** Takes the focus on open: the choice Enter should make */
  focus?: boolean;
}

const KIND = {
  muted: "text-text-muted hover:bg-white/5",
  plain: "text-text-secondary hover:bg-white/5",
  primary: "bg-accent font-semibold text-white hover:bg-accent/90",
};

/** A question with more than two answers (ConfirmDialog has two) */
export function ChoiceDialog({
  title,
  children,
  choices,
  onClose,
}: {
  title: string;
  children: ReactNode;
  choices: Choice[];
  onClose: () => void;
}) {
  const focusRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            if (!focusRef.current) return;
            e.preventDefault();
            // A focused webview keeps the keys (Esc included) unless it lets go first
            (document.activeElement as HTMLElement | null)?.blur();
            focusRef.current.focus();
          }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-bg-secondary p-5 shadow-2xl"
        >
          <Dialog.Title className="min-w-0 text-sm font-semibold text-text-primary">
            {title}
          </Dialog.Title>
          <Dialog.Description asChild>
            <div className="space-y-2 text-[11px] text-text-secondary">{children}</div>
          </Dialog.Description>
          <div className="flex flex-wrap justify-end gap-2">
            {choices.map((c) => (
              <button
                key={c.label}
                ref={c.focus ? focusRef : undefined}
                type="button"
                onClick={() => {
                  c.run?.();
                  onClose();
                }}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-medium ${KIND[c.kind ?? "plain"]}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
