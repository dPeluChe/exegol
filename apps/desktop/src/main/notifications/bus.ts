import type { NotificationEvent } from "@exegol/shared";
import { logger } from "../lib/logger";
import { desktopChannel } from "./channels/desktop";

/**
 * Wave 2 shared contract — notification delivery (T124).
 *
 * WT-A implements the desktop channel + wires T123 signals into emit().
 * WT-C/D emit through getNotificationBus() from day 1; the desktop channel
 * is registered by default so emitting is never a no-op once T123 signals
 * (or any other producer) start calling emit().
 *
 * Channel pattern from openclaw clones: one deliver() method per channel.
 */
export interface NotificationChannel {
  id: string;
  deliver(event: NotificationEvent): Promise<void> | void;
}

class NotificationBus {
  private channels: NotificationChannel[] = [];

  register(channel: NotificationChannel): void {
    if (this.channels.some((c) => c.id === channel.id)) return;
    this.channels.push(channel);
  }

  unregister(channelId: string): void {
    this.channels = this.channels.filter((c) => c.id !== channelId);
  }

  /** Delivery is fire-and-forget: a failing channel never breaks the caller. */
  emit(event: NotificationEvent): void {
    for (const channel of this.channels) {
      try {
        void Promise.resolve(channel.deliver(event)).catch((err) => {
          logger.warn(`[NotificationBus] channel ${channel.id} failed:`, err);
        });
      } catch (err) {
        logger.warn(`[NotificationBus] channel ${channel.id} threw:`, err);
      }
    }
  }
}

let instance: NotificationBus | null = null;

export function getNotificationBus(): NotificationBus {
  if (!instance) {
    instance = new NotificationBus();
    instance.register(desktopChannel);
  }
  return instance;
}
