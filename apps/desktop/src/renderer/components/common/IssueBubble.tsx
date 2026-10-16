import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import type { CapturedElement } from "../../lib/design-capture";
import { sendLabel, type TargetGroup } from "../terminal/send-targets";
import type { TargetPicker } from "../terminal/use-send-to";
import { AgentIcon } from "./AgentIcon";

const SECTION = "px-1 pt-1 text-[9px] font-semibold text-text-muted";

function TargetRows({
  group,
  names,
  onSend,
}: {
  group: TargetGroup;
  names: Record<string, string>;
  onSend: (agentId: string) => void;
}) {
  return (
    <>
      <p className={SECTION}>{group.label}</p>
      {group.targets.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSend(t.id)}
          className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] text-blue-200 hover:bg-blue-500/15"
        >
          <AgentIcon provider={t.cliType} size={11} />
          <span className="truncate">{sendLabel(t, names[t.id])}</span>
        </button>
      ))}
    </>
  );
}

interface IssueBubbleProps {
  element: CapturedElement;
  message: string;
  onMessageChange: (v: string) => void;
  targets: TargetPicker;
  onSend: (agentId: string) => void;
  onCopy: () => void;
  onDismiss: () => void;
}

export function IssueBubble({
  element,
  message,
  onMessageChange,
  targets,
  onSend,
  onCopy,
  onDismiss,
}: IssueBubbleProps) {
  const [showFolded, setShowFolded] = useState(false);
  const open = targets.groups.filter((g) => !g.folded);
  const folded = targets.groups.filter((g) => g.folded);
  // Nothing in this project: the other projects are the whole list
  const foldedShown = showFolded || open.length === 0;
  const { rect } = element;
  const cx = rect.x + rect.width / 2;
  const above = rect.y > 180;

  return (
    <div
      className="absolute z-30 w-72 overflow-hidden rounded-xl border border-blue-500/30 bg-bg-secondary/95 shadow-2xl backdrop-blur-sm"
      style={{
        left: `clamp(8px, ${Math.round(cx - 144)}px, calc(100% - 296px))`,
        ...(above
          ? { bottom: `calc(100% - ${rect.y - 10}px)` }
          : { top: `${rect.y + rect.height + 10}px` }),
      }}
    >
      {/* Arrow pointing toward the captured element */}
      <div
        className="absolute left-1/2 h-2.5 w-2.5 border-blue-500/30 bg-bg-secondary/95"
        style={
          above
            ? {
                bottom: -6,
                borderRightWidth: 1,
                borderBottomWidth: 1,
                transform: "translateX(-50%) rotate(45deg)",
              }
            : {
                top: -6,
                borderLeftWidth: 1,
                borderTopWidth: 1,
                transform: "translateX(-50%) rotate(45deg)",
              }
        }
      />
      <div className="p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-medium text-blue-300">
            &lt;{element.tagName}&gt; {rect.width}×{rect.height}px
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="text-[10px] leading-none text-text-muted hover:text-text-primary"
          >
            ×
          </button>
        </div>
        <p className="mb-2 truncate font-mono text-[9px] text-text-muted">{element.selector}</p>
        <textarea
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="Describe what needs to change (optional)..."
          aria-label="What needs to change"
          className="w-full resize-none rounded border border-border bg-bg-primary px-2 py-1 text-[10px] text-text-primary placeholder:text-text-muted/50 focus:border-blue-500/50 focus:outline-none"
          rows={2}
        />
        <div className="mt-2 max-h-48 overflow-y-auto">
          {targets.groups.length === 0 && (
            <p className="px-1 text-[10px] text-text-muted">No live agent to send to</p>
          )}
          {open.map((g) => (
            <TargetRows key={g.label} group={g} names={targets.names} onSend={onSend} />
          ))}
          {open.length > 0 && folded.length > 0 && (
            <button
              type="button"
              aria-expanded={showFolded}
              onClick={() => setShowFolded(!showFolded)}
              className="mt-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-[9px] text-text-muted hover:bg-white/10 hover:text-text-primary"
            >
              {showFolded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Other projects ({folded.length})
            </button>
          )}
          {foldedShown &&
            folded.map((g) => (
              <TargetRows key={g.label} group={g} names={targets.names} onSend={onSend} />
            ))}
        </div>
        <div className="mt-2 flex items-center">
          <button
            type="button"
            onClick={onCopy}
            className="ml-auto flex items-center gap-1 rounded border border-border px-2 py-1 text-[9px] text-text-secondary hover:bg-white/5 hover:text-text-primary"
            title="Copy the report to paste it anywhere"
          >
            <Copy className="h-2.5 w-2.5" /> Copy
          </button>
        </div>
      </div>
    </div>
  );
}
