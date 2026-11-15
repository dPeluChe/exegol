import { type InboxMessage, speechSentences } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, type Ref, useState } from "react";
import { sessionName } from "../../../lib/agent-label";
import { isLongMessage, keepLineBreaks } from "../../../lib/inbox-text";
import { useAgentStore } from "../../../stores/agents";
import { ChatMarkdown } from "./ChatMarkdown";

const PREVIEW_CHARS = 200;

const scrollIn = (el: HTMLElement | null) => el?.scrollIntoView({ block: "nearest" });

function authorLabel(m: InboxMessage, name: string | null): string {
  if (m.authorKind === "user") return "You";
  if (m.authorKind === "external") return "Captured";
  const cli = m.cli === name ? null : m.cli;
  return [name, cli, m.model, m.repo, m.branch, m.commit].filter(Boolean).join(", ") || "Agent";
}

function Message({
  message,
  open,
  onToggle,
  articleRef,
}: {
  message: InboxMessage;
  open: boolean;
  onToggle: () => void;
  articleRef?: Ref<HTMLElement>;
}) {
  const name = useAgentStore((s) => {
    const session = message.agentId ? s.agents[message.agentId] : undefined;
    return session ? sessionName(session) : null;
  });
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <article ref={articleRef} className="rounded-lg border border-border bg-bg-primary px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 text-left text-[10px] text-text-muted"
      >
        <Chevron className="h-3 w-3 shrink-0" />
        <span className={cn("truncate", !open && "max-w-[45%] shrink-0")}>
          {authorLabel(message, name)}
        </span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-text-secondary">
            {speechSentences(message.body, PREVIEW_CHARS).join(" ")}
          </span>
        )}
        <time className="ml-auto shrink-0">
          {new Date(message.createdAt * 1000).toLocaleString()}
        </time>
      </button>
      {open && (
        <div
          className={cn(
            "mt-1 text-xs text-text-primary",
            isLongMessage(message.body) && "h-56 min-h-16 resize-y overflow-y-auto pr-1",
          )}
        >
          <ChatMarkdown text={keepLineBreaks(message.body)} webLinks />
        </div>
      )}
    </article>
  );
}

/** Only the newest message is open, and in view; the rest fold to one line each */
export function InboxMessages({
  messages,
  children,
}: {
  messages: InboxMessage[];
  children?: ReactNode;
}) {
  const [toggled, setToggled] = useState<Record<number, boolean>>({});
  const lastSeq = messages.at(-1)?.seq;
  const isOpen = (seq: number) => toggled[seq] ?? seq === lastSeq;
  const allOpen = messages.every((m) => isOpen(m.seq));

  return (
    <div className="flex flex-col gap-2 p-3">
      {messages.length > 2 && (
        <button
          type="button"
          onClick={() =>
            setToggled(allOpen ? {} : Object.fromEntries(messages.map((m) => [m.seq, true])))
          }
          className="self-end text-[10px] text-text-muted hover:text-text-primary"
        >
          {allOpen ? "Collapse earlier" : `Expand all ${messages.length}`}
        </button>
      )}
      {messages.map((message) => (
        <Message
          key={message.seq}
          message={message}
          open={isOpen(message.seq)}
          onToggle={() => setToggled((t) => ({ ...t, [message.seq]: !isOpen(message.seq) }))}
          articleRef={message.seq === lastSeq ? scrollIn : undefined}
        />
      ))}
      {children}
    </div>
  );
}
