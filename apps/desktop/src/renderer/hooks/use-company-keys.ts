import { isTextField } from "../lib/ended-session";
import { type AgentState, jumpToAgent } from "../stores/agents";
import { useLatest } from "./use-latest";
import { useMountEffect } from "./use-mount-effect";

/** A key may act unless the user is typing, the mirror's own textarea included, or a dialog is up */
function companyKeysAllowed(active: HTMLElement | null): boolean {
  if (document.querySelector('[role="dialog"]')) return false;
  return !active || active === document.body || !isTextField(active);
}

/** P: the next that needs you. Enter: the desk in focus, else the selection, in its layout */
export function useCompanyKeys(keys: {
  pickNext: () => void;
  selected: AgentState | undefined;
  live: AgentState[];
}): void {
  const latest = useLatest(keys);
  useMountEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (!companyKeysAllowed(active)) return;
      const { pickNext, selected, live } = latest.current;
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
