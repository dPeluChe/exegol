import { playChime } from "../lib/chime";
import { showCommander } from "../lib/commander-view";
import { useToastStore } from "../stores/toasts";
import { useMountEffect } from "./use-mount-effect";

/** Its line when it calls, the same in every window */
export function commanderToast(body: string, action?: { label: string; run: () => void }): void {
  useToastStore
    .getState()
    .addToast({ type: "info", title: "Commander", body, action, durationMs: 20_000 });
}

/** The Commander called (`alert_person`): a chime, its line, and one click to its chat.
 *  Shown even with toasts off: it is an explicit call, once a minute at most */
export function useCommanderAlerts(): void {
  useMountEffect(() => {
    const offAlert = window.api.onCommanderAlert(({ message, sound }) => {
      if (sound) playChime();
      commanderToast(message, { label: "Open", run: showCommander });
    });
    const offOpen = window.api.onCommanderOpen(showCommander);
    return () => {
      offAlert();
      offOpen();
    };
  });
}
