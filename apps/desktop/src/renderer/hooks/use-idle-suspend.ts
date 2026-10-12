import { trpcMutate } from "../lib/trpc-client";
import { jumpToAgent, showProject, useAgentStore } from "../stores/agents";
import { useToastStore } from "../stores/toasts";
import { useWatchStore } from "../stores/watch";
import { useMountEffect } from "./use-mount-effect";

export interface IdleSuspendedSession {
  agentId: string;
  projectId: string;
  projectName: string;
  name: string;
  cliType: string;
  action: "suspended" | "closed";
}

export interface IdleSuspendEvent {
  days: number;
  sessions: IdleSuspendedSession[];
}

const SYNC_DELAY_MS = 1_000;
const NAMED = 3;
const LINKS = 4;

/** Pinned in Watching or with an unread attention item: the idle sweep leaves it alone */
function exemptIds(): string[] {
  const { attentionItems } = useAgentStore.getState();
  const unread = Object.values(attentionItems).filter((i) => !i.read);
  return [...new Set([...useWatchStore.getState().watched, ...unread.map((i) => i.agentId)])];
}

export const sessionLabel = (s: IdleSuspendedSession) =>
  `${s.name} (${s.projectName}${s.action === "closed" ? ", closed" : ""})`;

/** "nyx (Argos), krypton (CardSense), shell (Postino, closed) +2 more" */
export function idleSuspendSummary(sessions: IdleSuspendedSession[]): string {
  const named = sessions.slice(0, NAMED).map(sessionLabel).join(", ");
  const more = sessions.length - NAMED;
  return more > 0 ? `${named} +${more} more` : named;
}

const go = (s: IdleSuspendedSession) =>
  s.action === "closed" ? showProject(s.projectId) : jumpToAgent(s.agentId, s.projectId);

/** T205: main suspends idle agents and closes idle shells; this tells it which to keep and says
 *  what it did. Mounted once, in App */
export function useIdleSuspend(): void {
  useMountEffect(() => {
    let lastSent = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const send = () => {
      timer = null;
      const ids = exemptIds().sort();
      const key = ids.join(",");
      if (key === lastSent) return;
      lastSent = key;
      trpcMutate("agents.setIdleExempt", { agentIds: ids }).catch(() => {
        lastSent = "";
      });
    };
    // Throttled, not debounced: busy agents update the store more often than once a second
    const schedule = () => {
      timer ??= setTimeout(send, SYNC_DELAY_MS);
    };
    schedule();
    const unsubs = [useAgentStore.subscribe(schedule), useWatchStore.subscribe(schedule)];

    const offEvent = window.api.onIdleSuspended(({ days, sessions }) => {
      if (sessions.length === 0) return;
      const store = useAgentStore.getState();
      for (const s of sessions) {
        if (s.action !== "suspended") continue;
        store.updateAgent(s.agentId, { suspended: true });
        store.dismissAttention(s.agentId);
      }
      const first = sessions.find((s) => s.action === "suspended") ?? sessions[0];
      useToastStore.getState().addToast({
        type: "info",
        title: `Suspended ${sessions.length} idle session${sessions.length === 1 ? "" : "s"} (${days}+ day${days === 1 ? "" : "s"})`,
        body: idleSuspendSummary(sessions),
        agentId: first?.action === "suspended" ? first.agentId : undefined,
        durationMs: 30_000,
        links: sessions.slice(0, LINKS).map((s) => ({ label: sessionLabel(s), run: () => go(s) })),
        ...(first ? { action: { label: "Show", run: () => go(first) } } : {}),
      });
    });

    return () => {
      if (timer) clearTimeout(timer);
      for (const unsub of unsubs) unsub();
      offEvent();
    };
  });
}
