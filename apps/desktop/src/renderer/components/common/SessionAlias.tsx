import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";

interface SessionAliasProps {
  agent: { id: string; alias?: string | null; cliType: string };
  /** Text size class for the name span (dashboard uses text-sm, toolbar text-[9px]). */
  textClassName?: string;
}

/**
 * T160: session name — alias when set (falls back to provider), pencil to
 * rename inline. The alias is the agent_send addressing name, so renames
 * matter beyond looks. Also enters edit mode on the pane context menu's
 * `exegol:rename-session` event for this agent.
 */
export function SessionAlias({ agent, textClassName = "text-sm" }: SessionAliasProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ agentId?: string }>).detail;
      if (detail?.agentId === agent.id) {
        setDraft(agent.alias ?? "");
        setEditing(true);
      }
    };
    window.addEventListener("exegol:rename-session", handler);
    return () => window.removeEventListener("exegol:rename-session", handler);
  }, [agent.id, agent.alias]);

  const commit = () => {
    const alias = draft.trim() || null;
    trpcMutate("agents.setAlias", { id: agent.id, alias }).catch(() => {});
    useAgentStore.getState().updateAgent(agent.id, { alias });
    setEditing(false);
  };

  if (editing) {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: click shield while editing
      // biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation-only handler
      <span onClick={(e) => e.stopPropagation()}>
        <input
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          maxLength={40}
          placeholder={agent.cliType}
          className={`h-5 w-32 rounded border border-accent/50 bg-bg-primary px-1 font-medium text-text-primary focus:outline-none ${textClassName}`}
        />
      </span>
    );
  }

  return (
    <span className="group/alias flex min-w-0 items-center gap-1">
      <span className={`truncate font-medium text-text-primary ${textClassName}`}>
        {agent.alias ?? agent.cliType}
      </span>
      <button
        type="button"
        title="Rename session (addressing name for agent messages)"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(agent.alias ?? "");
          setEditing(true);
        }}
        className="hidden shrink-0 text-text-muted hover:text-text-primary group-hover/alias:inline-block"
      >
        <Pencil className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}
