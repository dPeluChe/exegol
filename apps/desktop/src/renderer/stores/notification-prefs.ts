import type { InterruptionLevel, NotificationMuteChannel, Settings } from "@exegol/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { trpcInvoke } from "../lib/trpc-client";

/**
 * T155.7 — per-channel notification kill switches.
 *
 * localStorage is the fast path for renderer-side toast suppression; every
 * toggle is also pushed to the settings table so the main-process desktop
 * channel enforces the same mutes on OS notifications.
 */

interface NotificationPrefsStore {
  mutedChannels: NotificationMuteChannel[];
  interruption: Record<string, InterruptionLevel>;
  isMuted: (channel: NotificationMuteChannel) => boolean;
  toggleChannel: (channel: NotificationMuteChannel) => void;
  levelOf: (projectId: string) => InterruptionLevel;
  /** "all" is the default, so it drops the project's key; also how a deleted project is forgotten */
  setLevel: (projectId: string, level: InterruptionLevel) => void;
  /** One-time sync from the settings table (DB wins over stale localStorage). */
  hydrateFromSettings: (muted: string[], interruption: Record<string, InterruptionLevel>) => void;
}

function pushToMain(update: Partial<Settings>): void {
  trpcInvoke("settings.update", update).catch((err) => {
    console.warn("[NotificationPrefs] Failed to sync to main:", err);
  });
}

export const useNotificationPrefsStore = create<NotificationPrefsStore>()(
  persist(
    (set, get) => ({
      mutedChannels: [],
      interruption: {},

      isMuted: (channel) => get().mutedChannels.includes(channel),

      toggleChannel: (channel) => {
        const current = get().mutedChannels;
        const next = current.includes(channel)
          ? current.filter((c) => c !== channel)
          : [...current, channel];
        set({ mutedChannels: next });
        pushToMain({ mutedNotificationChannels: next });
      },

      levelOf: (projectId) => get().interruption[projectId] ?? "all",

      setLevel: (projectId, level) => {
        if (get().levelOf(projectId) === level) return;
        const { [projectId]: _old, ...rest } = get().interruption;
        const next = level === "all" ? rest : { ...rest, [projectId]: level };
        set({ interruption: next });
        pushToMain({ projectInterruption: next });
      },

      hydrateFromSettings: (muted, interruption) => {
        set({ mutedChannels: muted as NotificationMuteChannel[], interruption });
      },
    }),
    {
      name: "exegol-notification-prefs",
      partialize: (state) => ({
        mutedChannels: state.mutedChannels,
        interruption: state.interruption,
      }),
    },
  ),
);
