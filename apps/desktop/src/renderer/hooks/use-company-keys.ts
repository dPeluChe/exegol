import { isTextField } from "../lib/ended-session";
import { adjacentId } from "../lib/pane-focus";
import { type AgentState, jumpToAgent } from "../stores/agents";
import { useLatest } from "./use-latest";
import { useMountEffect } from "./use-mount-effect";

const CHAT_INPUT = "[data-chat-input]";

/** Option+arrows and Option+N work from the chat input too. Never in a terminal: TUIs use them */
function sessionKey(
  e: KeyboardEvent,
  active: HTMLElement | null,
): "next" | "prev" | "needs" | null {
  if (!e.altKey || e.metaKey || e.ctrlKey || active?.closest(".xterm")) return null;
  if (e.code === "KeyN") return "needs";
  return e.key === "ArrowDown" ? "next" : e.key === "ArrowUp" ? "prev" : null;
}

/** P: the next that needs you. Enter: the desk in focus, else the selection, in its layout.
 *  Option+Up/Down: the session before or after. Option+N: as P, also while typing */
export function useCompanyKeys(keys: {
  pickNext: () => void;
  pick: (id: string) => void;
  selected: AgentState | undefined;
  live: AgentState[];
}): void {
  const latest = useLatest(keys);
  useMountEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const active = document.activeElement as HTMLElement | null;
      const { pickNext, pick, selected, live } = latest.current;
      const move = sessionKey(e, active);
      if (move) {
        const typing = active?.matches(CHAT_INPUT);
        if (move === "needs") {
          pickNext();
        } else {
          const next = adjacentId(
            live.map((a) => a.id),
            selected?.id ?? null,
            move,
          );
          if (next) pick(next);
        }
        e.preventDefault();
        e.stopPropagation();
        // After the panel shows the new session: its input is a new element
        requestAnimationFrame(() => {
          if (typing) document.querySelector<HTMLElement>(CHAT_INPUT)?.focus();
          document
            .querySelector('[aria-pressed="true"][data-desk-id]')
            ?.scrollIntoView({ block: "nearest" });
        });
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // A key may act unless the user is typing, the mirror's own textarea included
      if (active && active !== document.body && isTextField(active)) return;
      if (e.key.toLowerCase() === "p") {
        pickNext();
      } else if (e.key === "Enter") {
        // A desk in focus is the one meant; any other button keeps its own Enter
        const deskId = active?.dataset.deskId;
        if (!deskId && active?.closest("button, a")) return;
        const target = live.find((a) => a.id === deskId) ?? selected;
        if (!target) return;
        jumpToAgent(target.id, target.projectId);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });
}
