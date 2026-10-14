import { cn } from "@exegol/ui";
import { ArrowDownToLine, ArrowUpToLine, Send } from "lucide-react";
import type { RefObject } from "react";
import { appKeys } from "../../lib/keymap";
import { focusActivePane } from "../../lib/pane-focus";
import { SendToList } from "./SendToList";
import { hasSendTargets, type SendSections, type SendTarget } from "./send-targets";
import type { TerminalInstanceHandle } from "./TerminalInstance";

interface TerminalFloatingButtonsProps {
  terminalRef: RefObject<TerminalInstanceHandle | null>;
  scrollAtTop: boolean;
  scrollAtBottom: boolean;
  /** T155: output landed while scrolled up — pulse the scroll-down button */
  hasNewOutput?: boolean;
  /** Live agents, this project first; empty while nothing is selected (the button hides) */
  sendSections: SendSections;
  showSendTo: boolean;
  setShowSendTo: (v: boolean) => void;
  onSendTo: (target: SendTarget) => void;
}

export function TerminalFloatingButtons({
  terminalRef,
  scrollAtTop,
  scrollAtBottom,
  hasNewOutput = false,
  sendSections,
  showSendTo,
  setShowSendTo,
  onSendTo,
}: TerminalFloatingButtonsProps) {
  const canSend = hasSendTargets(sendSections);
  return (
    <div className="absolute right-6 bottom-3 z-10 flex flex-col items-end gap-1.5">
      {showSendTo && canSend && (
        <div
          className="mb-1 max-h-72 min-w-[200px] overflow-y-auto rounded-lg border p-1 shadow-xl"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
        >
          <p className="px-2 py-1 text-[9px] font-medium uppercase tracking-wider text-text-muted">
            Paste selection into
          </p>
          <SendToList
            sections={sendSections}
            onPick={onSendTo}
            onEscape={() => {
              setShowSendTo(false);
              focusActivePane();
            }}
          />
        </div>
      )}

      <div className="flex items-center gap-1">
        {canSend && (
          <button
            type="button"
            onClick={() => setShowSendTo(!showSendTo)}
            className={cn(
              "flex h-7 items-center gap-1 rounded-full border px-2.5 text-[10px] shadow-lg transition-all",
              showSendTo
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border bg-bg-secondary/90 text-text-muted hover:text-text-primary",
            )}
            title="Paste the selected text into another agent or terminal (never sent: add context or review it there)"
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
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border shadow-lg transition-colors",
              hasNewOutput
                ? "animate-pulse border-amber-500/50 bg-amber-500/15 text-amber-400"
                : "border-border bg-bg-secondary/90 text-text-muted hover:text-text-primary",
            )}
            title={`${hasNewOutput ? "New output below" : "Scroll to bottom"} (${appKeys("⌘↓")})`}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
