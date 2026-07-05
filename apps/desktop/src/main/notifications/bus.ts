import type { NotificationEvent } from "@exegol/shared";
import { logger } from "../lib/logger";

/**
 * Wave 2 shared contract — notification delivery (T124 skeleton).
 *
 * WT-A implements the desktop channel + wires T123 signals into emit().
 * WT-C/D emit through getNotificationBus() from day 1; with no channels
 * registered this is a safe no-op, so emitting never blocks a feature.
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
  if (!instance) instance = new NotificationBus();
  return instance;
}
