import { type InboxThread, inboxNeedsYou } from "@exegol/shared";
import { colabThreads, personalThreads } from "./inbox-menu";

/** What the Colabs tab lists: every thread, the person's own, or one colab's (its id) */
export const ALL_THREADS = "all";
export const PERSONAL = "personal";

export const channelThreads = (threads: InboxThread[], channel: string): InboxThread[] =>
  channel === ALL_THREADS
    ? threads
    : channel === PERSONAL
      ? personalThreads(threads)
      : colabThreads(threads, channel);

/** Active threads of a channel, and whether one waits on the person */
export function channelPending(active: InboxThread[], channel: string) {
  const threads = channelThreads(active, channel);
  return { count: threads.length, needsYou: inboxNeedsYou(threads) };
}
