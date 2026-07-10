import type { NotificationMuteChannel, Settings } from "@exegol/shared";
import { useEffect } from "react";
import { trpcInvoke } from "../lib/trpc-client";
import { jumpToAttentionItem, useAgentStore } from "../stores/agents";
import { useNotificationPrefsStore } from "../stores/notification-prefs";
import type { ToastType } from "../stores/toasts";
import { useToastStore } from "../stores/toasts";

// ─── Status → toast mapping ─────────────────────────────────────────────────

const STATUS_TOAST_MAP: Record<
  string,
  { type: ToastType; label: string; channel: NotificationMuteChannel }
> = {
  completed: { type: "success", label: "completed", channel: "agent:finished" },
  failed: { type: "error", label: "failed", channel: "agent:failed" },
  crashed: { type: "error", label: "crashed", channel: "agent:failed" },
};

/** CLIs that frequently toggle waiting_input (interactive TUIs) — skip toast for these */
const INTERACTIVE_CLI_TYPES = new Set(["crush", "gemini", "opencode", "kiro"]);
const TOAST_THROTTLE_MS = 10_000;

/**
 * Subscribe to IPC push events and surface them as in-app toasts.
 * Call once in App.tsx.
 */
export function useToastEvents(): void {
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // T155.7: reconcile per-channel mutes from the settings table once so a
    // cleared localStorage doesn't silently diverge from the main process.
    trpcInvoke<Settings>("settings.get")
      .then((settings) => {
        useNotificationPrefsStore
          .getState()
          .hydrateFromSettings(settings.mutedNotificationChannels ?? []);
      })
      .catch(() => {});

    // ── Agent status toasts (deduplicated + throttled per agent) ─────────
    const lastToasted = new Map<string, string>();
    const lastToastTime = new Map<string, number>();
    const unsubStatus = window.api.onAgentStatus((event) => {
      if (event.cliType === "shell") return;

      const mapping = STATUS_TOAST_MAP[event.status];
      if (!mapping) return;

      // T155.7: per-channel kill switch (renderer-side toast suppression)
      if (useNotificationPrefsStore.getState().isMuted(mapping.channel)) return;

      // Skip waiting_input toasts for interactive CLIs (they toggle constantly)
      if (event.status === "waiting_input" && INTERACTIVE_CLI_TYPES.has(event.cliType)) return;

      // Skip if same agent+status was already toasted
      const prev = lastToasted.get(event.agentId);
      if (prev === event.status) return;

      // Throttle: max 1 toast per agent every 10s
      const now = Date.now();
      const lastTime = lastToastTime.get(event.agentId) ?? 0;
      if (now - lastTime < TOAST_THROTTLE_MS) return;

      lastToasted.set(event.agentId, event.status);
      lastToastTime.set(event.agentId, now);

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
      // T155.3: land on the exact pane of the agent that raised the notification
      const agent = useAgentStore.getState().agents[data.agentId];
      if (agent) jumpToAttentionItem(data.agentId, agent.projectId);
    });
    if (unsubNav) cleanups.push(unsubNav);

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, []);
}
