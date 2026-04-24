import { Send } from "lucide-react";
import type { CapturedElement } from "../../lib/design-capture";

export interface AgentRef {
  id: string;
  cliType: string;
}

export interface IssueBubbleProps {
  element: CapturedElement;
  message: string;
  onMessageChange: (v: string) => void;
  agents: AgentRef[];
  onSend: (agentId: string) => void;
  onCopy: () => void;
  onDismiss: () => void;
}

export function IssueBubble({
  element,
  message,
  onMessageChange,
  agents,
  onSend,
  onCopy,
  onDismiss,
}: IssueBubbleProps) {
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
          className="w-full resize-none rounded border border-border bg-bg-primary px-2 py-1 text-[10px] text-text-primary placeholder:text-text-muted/50 focus:border-blue-500/50 focus:outline-none"
          rows={2}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSend(a.id)}
              className="flex items-center gap-1 rounded bg-blue-500/10 px-2 py-1 text-[9px] text-blue-300 hover:bg-blue-500/20"
            >
              <Send className="h-2.5 w-2.5" /> {a.cliType}
            </button>
          ))}
          <button
            type="button"
            onClick={onCopy}
            className="rounded px-2 py-1 text-[9px] text-text-muted hover:bg-white/5"
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}
