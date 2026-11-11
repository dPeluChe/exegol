import type { Agent } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useRef, useState } from "react";
import { useProjects } from "../../../hooks/use-trpc";
import { sessionName } from "../../../lib/agent-label";
import { applyMention, type Mention, matchMentions, mentionAt } from "../../../lib/mentions";
import { trpcInvoke } from "../../../lib/trpc-client";

type Listed = Agent & { projectName: string };

/** Every other project and live session, by the names the Commander knows them by */
function useMentionNames(enabled: boolean, ownProjectId: string): Mention[] {
  const { data: projects = [] } = useProjects();
  const { data: sessions = [] } = useQuery({
    queryKey: ["agents", "listActive"],
    queryFn: () => trpcInvoke<Listed[]>("agents.listActive"),
    enabled,
    staleTime: 15_000,
  });
  if (!enabled) return [];
  return [
    ...sessions
      .filter((a) => a.cliType !== "shell" && a.projectId !== ownProjectId)
      .map((a): Mention => ({ name: sessionName(a), kind: "session", detail: a.projectName })),
    ...projects
      .filter((p) => p.id !== ownProjectId)
      .map((p): Mention => ({ name: p.name, kind: "project" })),
  ];
}

/** `@` in the input offers project and session names. `onKeyDown` returns true when it took the key */
export function useMentions({
  enabled,
  ownProjectId,
  draft,
  setDraft,
}: {
  enabled: boolean;
  ownProjectId: string;
  draft: string;
  setDraft: (text: string) => void;
}) {
  const names = useMentionNames(enabled, ownProjectId);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState(0);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const typing = enabled ? mentionAt(draft, caret) : null;
  const open = typing && typing.start !== closedAt ? typing : null;
  const options = open ? matchMentions(names, open.query) : [];
  const active = Math.min(picked, options.length - 1);

  const pick = (mention: Mention) => {
    if (!open) return;
    const next = applyMention(draft, open.start, caret, mention.name);
    setDraft(next.text);
    setCaret(next.caret);
    setPicked(0);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(next.caret, next.caret));
  };

  return {
    options,
    active,
    pick,
    inputRef,
    /** After every edit or caret move */
    track: () => {
      setCaret(inputRef.current?.selectionStart ?? 0);
      setPicked(0);
    },
    onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
      if (!open || options.length === 0) return false;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const step = e.key === "ArrowDown" ? 1 : options.length - 1;
        setPicked((active + step) % options.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        const chosen = options[active];
        if (chosen) pick(chosen);
      } else if (e.key === "Escape") {
        setClosedAt(open.start);
      } else return false;
      e.preventDefault();
      return true;
    },
  };
}

export function MentionMenu({
  options,
  active,
  onPick,
}: {
  options: Mention[];
  active: number;
  onPick: (mention: Mention) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="Projects and sessions"
      className="absolute bottom-full left-0 z-10 mb-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-border bg-bg-secondary p-1 text-xs shadow-lg"
    >
      {options.map((m, i) => (
        <button
          key={`${m.kind}:${m.name}:${m.detail ?? ""}`}
          type="button"
          role="option"
          aria-selected={i === active}
          // Keeps the focus in the input
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(m)}
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1 text-left",
            i === active
              ? "bg-accent/15 text-text-primary"
              : "text-text-secondary hover:bg-white/5",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{m.name}</span>
          <span className="shrink-0 text-[10px] text-text-muted">
            {m.kind === "project" ? "project" : m.detail}
          </span>
        </button>
      ))}
    </div>
  );
}
