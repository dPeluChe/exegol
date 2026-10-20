import { markSuspended } from "../lib/session-quiet";
import { trpcMutate } from "../lib/trpc-client";
import { jumpToAgent, showProject, useAgentStore } from "../stores/agents";
import { useToastStore } from "../stores/toasts";
import { useWatchStore } from "../stores/watch";
import { useMountEffect } from "./use-mount-effect";

export interface IdleSuspendedSession {
  agentId: string;
  projectId: string;
  projectName: string;
  /** Alias, else the CLI's display name */
  name: string;
  cliType: string;
  action: "suspended" | "closed";
}

export type IdleSuspendEvent =
  | { type: "suspending"; agentId: string }
  | { type: "done"; days: number; sessions: IdleSuspendedSession[]; failed: string[] };

const SYNC_DELAY_MS = 1_000;
const LINKS = 5;

/** Pinned in Watching or with an unread attention item: the idle sweep leaves it alone */
function exemptIds(): string[] {
  const { attentionItems } = useAgentStore.getState();
  const unread = Object.values(attentionItems).filter((i) => !i.read);
  return [...new Set([...useWatchStore.getState().watched, ...unread.map((i) => i.agentId)])];
}

const plural = (n: number, word: string) => `${n} idle ${word}${n === 1 ? "" : "s"}`;

/** "Suspended 2 idle sessions, closed 1 idle terminal" */
export function idleSuspendTitle(sessions: IdleSuspendedSession[]): string {
  const suspended = sessions.filter((s) => s.action === "suspended").length;
  const closed = sessions.length - suspended;
  const parts = [
    suspended > 0 && `suspended ${plural(suspended, "session")}`,
    closed > 0 && `closed ${plural(closed, "terminal")}`,
  ].filter((p): p is string => !!p);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "nyx (Argos)", "Terminal (Postino, closed)" */
export const sessionLabel = (s: IdleSuspendedSession) =>
  `${s.name} (${s.projectName}${s.action === "closed" ? ", closed" : ""})`;

const go = (s: IdleSuspendedSession) =>
  s.action === "closed" ? showProject(s.projectId) : jumpToAgent(s.agentId, s.projectId);

function showDone({ days, sessions, failed }: Extract<IdleSuspendEvent, { type: "done" }>) {
  for (const id of failed) markSuspended(id, false);
  if (sessions.length === 0) return;
  const more = sessions.length - LINKS;
  useToastStore.getState().addToast({
    type: "info",
    title: `${idleSuspendTitle(sessions)} (${days}+ day${days === 1 ? "" : "s"})`,
    body: more > 0 ? `+${more} more` : undefined,
    durationMs: 30_000,
    links: sessions.slice(0, LINKS).map((s) => ({
      id: s.agentId,
      label: sessionLabel(s),
      run: () => go(s),
    })),
  });
}

/** T205: main suspends idle agents and closes idle terminals; this tells it which to keep and
 *  says what it did. Mounted once, in App */
export function useIdleSuspend(): void {
  useMountEffect(() => {
    let lastSent: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const send = () => {
      timer = null;
      const ids = exemptIds().sort();
      const key = ids.join(",");
      if (key === lastSent) return;
      lastSent = key;
      trpcMutate("agents.setIdleExempt", { agentIds: ids }).catch(() => {
        lastSent = null;
      });
    };
    // Throttled, not debounced: busy agents update the store more often than once a second
    const schedule = () => {
      timer ??= setTimeout(send, SYNC_DELAY_MS);
    };
    schedule();
    const unsubs = [useAgentStore.subscribe(schedule), useWatchStore.subscribe(schedule)];

    const offEvent = window.api.onIdleSuspended((event) => {
      if (event.type === "suspending") markSuspended(event.agentId);
      else showDone(event);
    });

    return () => {
      if (timer) clearTimeout(timer);
      for (const unsub of unsubs) unsub();
      offEvent();
    };
  });
}
