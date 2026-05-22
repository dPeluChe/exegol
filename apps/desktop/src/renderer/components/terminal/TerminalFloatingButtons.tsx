import { cn } from "@exegol/ui";
import { ArrowDownToLine, ArrowUpToLine, Send } from "lucide-react";
import type { RefObject } from "react";
import type { TerminalInstanceHandle } from "./TerminalInstance";

interface TerminalFloatingButtonsProps {
  terminalRef: RefObject<TerminalInstanceHandle | null>;
  scrollAtTop: boolean;
  scrollAtBottom: boolean;
  sendTargets: Array<{ id: string; cliType: string; taskDescription: string }>;
  showSendTo: boolean;
  setShowSendTo: (v: boolean) => void;
  onSendTo: (targetId: string) => void;
}

export function TerminalFloatingButtons({
  terminalRef,
  scrollAtTop,
  scrollAtBottom,
  sendTargets,
  showSendTo,
  setShowSendTo,
  onSendTo,
}: TerminalFloatingButtonsProps) {
  return (
    <div className="absolute right-3 bottom-3 z-10 flex flex-col items-end gap-1.5">
      {showSendTo && sendTargets.length > 0 && (
        <div
          className="mb-1 rounded-lg border p-1 shadow-xl"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
        >
          <p className="px-2 py-1 text-[9px] font-medium uppercase tracking-wider text-text-muted">
            Send selection to
          </p>
          {sendTargets.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSendTo(a.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-[11px] text-text-secondary hover:bg-white/10"
            >
              <span className="font-medium text-accent">{a.cliType}</span>
              <span className="truncate text-text-muted">
                {a.taskDescription?.slice(0, 40) || a.id}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1">
        {sendTargets.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSendTo(!showSendTo)}
            className={cn(
              "flex h-7 items-center gap-1 rounded-full border px-2.5 text-[10px] shadow-lg transition-all",
              showSendTo
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border bg-bg-secondary/90 text-text-muted hover:text-text-primary",
            )}
            title="Send selected text to another agent"
          >
            <Send className="h-3 w-3" />
            <span>Send to</span>
          </button>
        )}

        {!scrollAtTop && (
          <button
            type="button"
            onClick={() => terminalRef.current?.scrollToTop()}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg-secondary/90 text-text-muted shadow-lg transition-colors hover:text-text-primary"
            title="Scroll to top"
          >
            <ArrowUpToLine className="h-3.5 w-3.5" />
          </button>
        )}
        {!scrollAtBottom && (
          <button
            type="button"
            onClick={() => terminalRef.current?.scrollToBottom()}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg-secondary/90 text-text-muted shadow-lg transition-colors hover:text-text-primary"
            title="Scroll to bottom"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
