import { playChime } from "../lib/chime";
import { useAppStore } from "../stores/app";
import { useToastStore } from "../stores/toasts";
import { useMountEffect } from "./use-mount-effect";

function openCommander(): void {
  const app = useAppStore.getState();
  app.openDashboard();
  app.setDashboardMode("commander");
}

/** The Commander called (`alert_person`): a chime, its line, and one click to its chat.
 *  Shown even with toasts off: it is an explicit call, once a minute at most */
export function useCommanderAlerts(): void {
  useMountEffect(() => {
    const offAlert = window.api.onCommanderAlert(({ message, sound }) => {
      if (sound) playChime();
      useToastStore.getState().addToast({
        type: "info",
        title: "Commander",
        body: message,
        action: { label: "Open", run: openCommander },
        durationMs: 20_000,
      });
    });
    const offOpen = window.api.onCommanderOpen(openCommander);
    return () => {
      offAlert();
      offOpen();
    };
  });
}
