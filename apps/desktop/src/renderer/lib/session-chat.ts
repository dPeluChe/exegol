import type { AgentStatus, ChatPage, ChatPeerMessage, ChatTurn } from "@exegol/shared";

export const MAX_CHAT_TURNS = 200;
// A prompt can wrap the message: its opening is enough to know it
const PEER_MATCH_CHARS = 200;

export type ChatHistory = Omit<ChatPage, "reset">;

export type ChatBubble =
  | { kind: "turn"; id: string; role: "user" | "assistant"; text: string }
  | { kind: "tools"; id: string; names: string[] }
  | { kind: "peer"; id: string; peer: ChatPeerMessage };

export function appendChatPage(prev: ChatHistory | undefined, page: ChatPage): ChatHistory {
  const turns = page.reset || !prev ? page.turns : [...prev.turns, ...page.turns];
  return {
    turns: turns.slice(-MAX_CHAT_TURNS),
    cursor: page.cursor,
    source: page.source,
    peers: page.peers,
  };
}

/** Turns in file order, peers by time. A peer's message is also typed into the session: shown
 *  once, as the peer's. Terminal turns have no time, so peers follow them */
export function mergeChat(turns: ChatTurn[], peers: ChatPeerMessage[]): ChatBubble[] {
  const incoming = peers
    .filter((p) => p.incoming)
    .map((p) => p.text.trim().slice(0, PEER_MATCH_CHARS))
    .filter(Boolean);
  const bubbles: ChatBubble[] = [];
  let next = 0;
  const peersUntil = (at: number) => {
    for (; (peers[next]?.at ?? Number.POSITIVE_INFINITY) <= at; next++) {
      const peer = peers[next] as ChatPeerMessage;
      bubbles.push({ kind: "peer", id: `peer:${peer.id}`, peer });
    }
  };
  for (const turn of turns) {
    if (turn.role === "user" && incoming.some((text) => turn.text.includes(text))) continue;
    if (turn.at !== null) peersUntil(turn.at);
    const last = bubbles.at(-1);
    if (turn.role !== "tool") {
      bubbles.push({ kind: "turn", id: turn.id, role: turn.role, text: turn.text });
    } else if (last?.kind === "tools") {
      last.names.push(turn.text);
    } else {
      bubbles.push({ kind: "tools", id: turn.id, names: [turn.text] });
    }
  }
  peersUntil(Number.MAX_SAFE_INTEGER);
  return bubbles;
}

/** "Read x3, Bash", in the order first used */
export function toolsLine(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 ? `${name} x${n}` : name)).join(", ");
}

export type SendDecision = "send" | "queue" | "question" | "closed";

/** Main delivers either way; this says what the input promises, and when it must not send */
export function sendDecision(session: {
  accepts: boolean;
  status: AgentStatus;
  asks: boolean;
}): SendDecision {
  if (!session.accepts) return "closed";
  if (session.asks) return "question";
  return session.status === "waiting_input" || session.status === "idle" ? "send" : "queue";
}

export function chatSummary(turns: ChatTurn[], where: string, status: AgentStatus): string {
  const last = turns.findLast((t) => t.role === "assistant");
  return [where, `Status: ${status}`, ...(last ? ["", last.text] : [])].join("\n");
}
