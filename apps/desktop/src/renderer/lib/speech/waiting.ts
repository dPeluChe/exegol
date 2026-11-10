export interface WaitingReply {
  key: string;
  text: string;
  agentId: string;
}

export const MAX_WAITING = 5;

/** Replies wait in the order they came; a reply already waiting keeps its place, the oldest gives way */
export function addWaiting(
  waiting: readonly WaitingReply[],
  reply: WaitingReply,
  max = MAX_WAITING,
): WaitingReply[] {
  if (waiting.some((w) => w.key === reply.key)) return [...waiting];
  return [...waiting, reply].slice(-max);
}
