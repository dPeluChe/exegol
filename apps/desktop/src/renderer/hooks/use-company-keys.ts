import { stepDesk } from "../lib/company";
import { isTextField } from "../lib/ended-session";
import { type AgentState, jumpToAgent } from "../stores/agents";
import { useLatest } from "./use-latest";
import { useMountEffect } from "./use-mount-effect";

/** A key may act unless the user is typing, the mirror's own textarea included, or a dialog is up */
function companyKeysAllowed(active: HTMLElement | null): boolean {
  if (document.querySelector('[role="dialog"]')) return false;
  return !active || active === document.body || !isTextField(active);
}

const CHAT_INPUT = "[data-chat-input]";

/** Option+arrows and Option+N work from the chat input too. Never in a terminal: TUIs use them */
function sessionKey(e: KeyboardEvent, active: HTMLElement | null): number | "needs" | null {
  if (!e.altKey || e.metaKey || e.ctrlKey || active?.closest(".xterm")) return null;
  if (document.querySelector('[role="dialog"]')) return null;
  if (e.code === "KeyN") return "needs";
  return e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : null;
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
      const active = document.activeElement as HTMLElement | null;
      const { pickNext, pick, selected, live } = latest.current;
      const move = sessionKey(e, active);
      if (move !== null) {
        const typing = active?.matches(CHAT_INPUT);
        const ids = live.map((a) => a.id);
        const next = move === "needs" ? null : stepDesk(ids, selected?.id ?? null, move);
        if (next) pick(next);
        else if (move === "needs") pickNext();
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
      if (!companyKeysAllowed(active)) return;
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
