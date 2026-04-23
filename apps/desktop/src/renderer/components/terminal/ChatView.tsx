/**
 * T90: Chat-style view of an agent's terminal output.
 * Read-only conversational representation parsed from scrollback.
 */

import { cn, ScrollArea } from "@exegol/ui";
import { Bot, Terminal, User } from "lucide-react";
import { useMemo } from "react";
import { type ChatRole, type ChatTurn, parseTerminalToChat } from "../../lib/terminal-to-chat";

interface ChatViewProps {
  scrollback: string;
  cliType?: string;
}

const ROLE_CONFIG: Record<ChatRole, { icon: typeof User; label: string; bgClass: string; textClass: string }> = {
  user: { icon: User, label: "You", bgClass: "bg-accent/10", textClass: "text-accent" },
  agent: { icon: Bot, label: "Agent", bgClass: "bg-white/5", textClass: "text-text-secondary" },
  system: { icon: Terminal, label: "System", bgClass: "bg-white/[0.02]", textClass: "text-text-muted" },
};

function ChatBubble({ turn }: { turn: ChatTurn }) {
  const config = ROLE_CONFIG[turn.role];
  const Icon = config.icon;

  return (
    <div className={cn("flex gap-2.5 px-4 py-3", config.bgClass)}>
      <div className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", config.bgClass)}>
        <Icon className={cn("h-3 w-3", config.textClass)} />
      </div>
      <div className="min-w-0 flex-1">
        <span className={cn("text-[10px] font-semibold uppercase tracking-wider", config.textClass)}>
          {config.label}
        </span>
        <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-text-primary">
          {turn.content}
        </pre>
      </div>
    </div>
  );
}

export function ChatView({ scrollback, cliType }: ChatViewProps) {
  const turns = useMemo(() => parseTerminalToChat(scrollback), [scrollback]);

  if (turns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        <p className="text-xs">No conversation data to display</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col divide-y divide-border/30">
        {cliType && (
          <div className="px-4 py-2 text-[10px] font-medium text-text-muted">
            {cliType} session — {turns.length} turns
          </div>
        )}
        {turns.map((turn, i) => (
          <ChatBubble key={`${turn.lineIndex}-${i}`} turn={turn} />
        ))}
      </div>
    </ScrollArea>
  );
}
