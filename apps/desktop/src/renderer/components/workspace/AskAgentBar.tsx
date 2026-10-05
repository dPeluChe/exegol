import { cn } from "@exegol/ui";
import { MessageSquare, MousePointer2, Send, X } from "lucide-react";
import { useState } from "react";
import { sessionName } from "../../lib/agent-label";
import { buildAskAgentMessage } from "../../lib/ask-agent";
import type { CapturedElement } from "../../lib/design-capture";
import { trpcMutate } from "../../lib/trpc-client";
import { useAgentBrowserPane } from "../../stores/agent-browser";
import type { AgentState } from "../../stores/agents";
import { useToastStore } from "../../stores/toasts";

/** Address bar button: shown while the project has live agents */
export function AskAgentButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-5 items-center gap-1 rounded px-1 text-[10px] transition-colors",
        active ? "bg-accent/20 text-accent" : "text-text-muted hover:bg-white/10",
      )}
      title="Ask an agent about this page (it gets the URL, your note and a picked element)"
    >
      <MessageSquare className="h-3 w-3" />
      Ask agent
    </button>
  );
}

/** Pick the agent (default: the one that last used this pane), add a note and optionally a
 *  section of the page, and send it through the follow-up queue */
export function AskAgentBar({
  paneId,
  agents,
  currentUrl,
  getTitle,
  element,
  picking,
  onPick,
  onClearElement,
  onClose,
}: {
  paneId: string;
  agents: AgentState[];
  currentUrl: string;
  getTitle: () => string;
  element: CapturedElement | null;
  picking: boolean;
  onPick: () => void;
  onClearElement: () => void;
  onClose: () => void;
}) {
  const lastDriver = useAgentBrowserPane(paneId)?.agentId;
  const fallback = agents.find((a) => a.id === lastDriver)?.id ?? agents[0]?.id ?? "";
  const [chosen, setChosen] = useState<string | null>(null);
  const agentId = chosen && agents.some((a) => a.id === chosen) ? chosen : fallback;
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!agentId || sending) return;
    setSending(true);
    try {
      const text = buildAskAgentMessage({
        paneId,
        url: currentUrl,
        title: getTitle(),
        note,
        element,
      });
      const r = await trpcMutate<{ delivered: boolean }>("agents.queueFollowUp", {
        id: agentId,
        text,
      });
      useToastStore.getState().addToast({
        type: "success",
        title: r.delivered ? "Sent to the agent" : "Queued for the agent's next turn",
      });
      onClearElement();
      onClose();
    } catch (err) {
      useToastStore.getState().addToast({
        type: "error",
        title: "Could not send",
        body: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSending(false);
    }
  };

  const field =
    "h-6 rounded border border-border bg-bg-tertiary px-1.5 text-[11px] text-text-primary outline-none focus:border-accent/50";
  return (
    <form
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-bg-secondary/80 px-2 py-1"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <select
        value={agentId}
        onChange={(e) => setChosen(e.target.value)}
        aria-label="Agent"
        className={cn(field, "max-w-[10rem]")}
      >
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {sessionName(a)}
          </option>
        ))}
      </select>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What should it look at? (optional)"
        aria-label="Note for the agent"
        maxLength={2000}
        className={cn(field, "min-w-[8rem] flex-1")}
      />
      {element ? (
        <span className="flex max-w-[12rem] items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-300">
          <span className="truncate" title={element.selector}>
            {element.selector}
          </span>
          <button type="button" onClick={onClearElement} aria-label="Drop the picked element">
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={onPick}
          className={cn(
            "flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[10px]",
            picking ? "bg-blue-500/20 text-blue-300" : "text-text-muted hover:bg-white/10",
          )}
          title="Click a part of the page to send with the question"
        >
          <MousePointer2 className="h-3 w-3" />
          {picking ? "Click the page..." : "Pick a section"}
        </button>
      )}
      <button
        type="submit"
        disabled={!agentId || sending}
        className="flex h-6 items-center gap-1 rounded bg-accent px-2 text-[10px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
      >
        <Send className="h-3 w-3" />
        Send
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="rounded p-0.5 text-text-muted hover:text-text-primary"
      >
        <X className="h-3 w-3" />
      </button>
    </form>
  );
}
