import { cn } from "@exegol/ui";
import { ArrowDownToLine, ArrowUpToLine, Send } from "lucide-react";
import type { RefObject } from "react";
import { AgentIcon } from "../common/AgentIcon";
import type { TerminalInstanceHandle } from "./TerminalInstance";
import type { SendTarget } from "./use-terminal-panel-actions";

interface TerminalFloatingButtonsProps {
  terminalRef: RefObject<TerminalInstanceHandle | null>;
  scrollAtTop: boolean;
  scrollAtBottom: boolean;
  /** T155: output landed while scrolled up — pulse the scroll-down button */
  hasNewOutput?: boolean;
  /** Live agents by project; empty while nothing is selected (the button hides) */
  sendGroups: Array<{ projectId: string; projectName: string; targets: SendTarget[] }>;
  showSendTo: boolean;
  setShowSendTo: (v: boolean) => void;
  onSendTo: (target: SendTarget) => void;
}

export function TerminalFloatingButtons({
  terminalRef,
  scrollAtTop,
  scrollAtBottom,
  hasNewOutput = false,
  sendGroups,
  showSendTo,
  setShowSendTo,
  onSendTo,
}: TerminalFloatingButtonsProps) {
  return (
    <div className="absolute right-6 bottom-3 z-10 flex flex-col items-end gap-1.5">
      {showSendTo && sendGroups.length > 0 && (
        <div
          className="mb-1 max-h-72 overflow-y-auto rounded-lg border p-1 shadow-xl"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
        >
          <p className="px-2 py-1 text-[9px] font-medium uppercase tracking-wider text-text-muted">
            Paste selection into
          </p>
          {sendGroups.map((group) => (
            <div
              key={group.projectId}
              className="mt-1 border-t border-border/60 pt-1 first:mt-0 first:border-t-0 first:pt-0"
            >
              <p className="px-2 py-0.5 text-[9px] font-semibold text-text-secondary">
                {group.projectName}
              </p>
              {group.targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSendTo(t)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-[11px] text-text-secondary hover:bg-white/10"
                >
                  <AgentIcon provider={t.cliType} size={12} />
                  <span className="font-medium text-text-primary">{t.name}</span>
                  {t.name !== t.cliType && (
                    <span className="truncate text-text-muted">{t.cliType}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1">
        {sendGroups.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSendTo(!showSendTo)}
            className={cn(
              "flex h-7 items-center gap-1 rounded-full border px-2.5 text-[10px] shadow-lg transition-all",
              showSendTo
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border bg-bg-secondary/90 text-text-muted hover:text-text-primary",
            )}
            title="Paste the selected text into another agent (it is not sent: add context there)"
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
            title={hasNewOutput ? "New output below (⌘↓)" : "Scroll to bottom (⌘↓)"}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
