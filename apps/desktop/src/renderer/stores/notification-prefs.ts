import type { NotificationMuteChannel } from "@exegol/shared";
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
  isMuted: (channel: NotificationMuteChannel) => boolean;
  toggleChannel: (channel: NotificationMuteChannel) => void;
  /** One-time sync from the settings table (DB wins over stale localStorage). */
  hydrateFromSettings: (muted: string[]) => void;
}

function pushToMain(muted: NotificationMuteChannel[]): void {
  trpcInvoke("settings.update", { mutedNotificationChannels: muted }).catch((err) => {
    console.warn("[NotificationPrefs] Failed to sync muted channels to main:", err);
  });
}

export const useNotificationPrefsStore = create<NotificationPrefsStore>()(
  persist(
    (set, get) => ({
      mutedChannels: [],

      isMuted: (channel) => get().mutedChannels.includes(channel),

      toggleChannel: (channel) => {
        const current = get().mutedChannels;
        const next = current.includes(channel)
          ? current.filter((c) => c !== channel)
          : [...current, channel];
        set({ mutedChannels: next });
        pushToMain(next);
      },

      hydrateFromSettings: (muted) => {
        set({ mutedChannels: muted as NotificationMuteChannel[] });
      },
    }),
    {
      name: "exegol-notification-prefs",
      partialize: (state) => ({ mutedChannels: state.mutedChannels }),
    },
  ),
);
