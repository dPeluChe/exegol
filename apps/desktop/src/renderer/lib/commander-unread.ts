import type { SessionBubble } from "./session-chat";

/** The bubble the unread replies start at: the first reply written at or after `since` */
export function firstUnreadId(
  bubbles: readonly SessionBubble[],
  since: number | null,
): string | null {
  if (since === null) return null;
  for (const b of bubbles) {
    if (b.kind === "turn" && b.role === "assistant" && b.at !== null && b.at >= since) return b.id;
  }
  return null;
}
