import { useEffect } from "react";
import type { ToastType } from "../stores/toasts";
import { useToastStore } from "../stores/toasts";

// ─── Status → toast mapping ─────────────────────────────────────────────────

const STATUS_TOAST_MAP: Record<string, { type: ToastType; label: string }> = {
  completed: { type: "success", label: "completed" },
  failed: { type: "error", label: "failed" },
  crashed: { type: "error", label: "crashed" },
  waiting_input: { type: "warning", label: "waiting for input" },
};

/**
 * Subscribe to IPC push events and surface them as in-app toasts.
 * Call once in App.tsx.
 */
export function useToastEvents(): void {
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // ── Agent status toasts (deduplicated per agent+status) ─────────────
    const lastToasted = new Map<string, string>(); // agentId → last status toasted
    const unsubStatus = window.api.onAgentStatus((event) => {
      if (event.cliType === "shell") return;

      const mapping = STATUS_TOAST_MAP[event.status];
      if (!mapping) return;

      // Skip if same agent+status was already toasted (prevents spam from rapid status cycling)
      const prev = lastToasted.get(event.agentId);
      if (prev === event.status) return;
      lastToasted.set(event.agentId, event.status);

      useToastStore.getState().addToast({
        type: mapping.type,
        title: `Agent ${mapping.label}`,
        body: `${event.cliType} agent ${mapping.label}`,
        agentId: event.agentId,
      });
    });
    cleanups.push(unsubStatus);

    // ── Notification navigate (system notification click) ───────────────
    const unsubNav = window.api.onNotificationNavigate?.((data) => {
      window.dispatchEvent(
        new CustomEvent("exegol:switch-section", {
          detail: { section: "agents" },
        }),
      );
      // Optionally focus the specific agent's pane in the future
      void data;
    });
    if (unsubNav) cleanups.push(unsubNav);

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, []);
}
