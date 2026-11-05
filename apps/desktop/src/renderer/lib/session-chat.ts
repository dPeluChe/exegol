import {
  type AgentMessage,
  type AgentStatus,
  type ChatPage,
  injectedHeaders,
  type OlderChatPage,
  type SessionTurn,
} from "@exegol/shared";

export type ChatHistory = Omit<ChatPage, "reset">;

export type SessionBubble =
  | { kind: "turn"; id: string; role: "user" | "assistant"; text: string; at: number | null }
  | { kind: "tools"; id: string; names: string[] }
  | { kind: "peer"; id: string; message: AgentMessage };

export function appendChatPage(prev: ChatHistory | undefined, page: ChatPage): ChatHistory {
  const fresh = page.reset || !prev;
  return {
    turns: fresh ? page.turns : [...prev.turns, ...page.turns],
    cursor: page.cursor,
    fromTerminal: page.fromTerminal,
    older: fresh ? page.older : prev.older,
  };
}

/** `before` is the `older` the page was asked with: a reset since then makes it another history */
export function prependChatPage(
  history: ChatHistory,
  page: OlderChatPage,
  before: string,
): ChatHistory {
  if (history.older !== before) return history;
  return { ...history, turns: [...page.turns, ...history.turns], older: page.older };
}

/** "14:05", with the day once it is not today */
export function chatTime(at: number, now = new Date()): string {
  const date = new Date(at * 1000);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** Turns in file order, `messages` (oldest first) by time. A message typed into this session is
 *  also a turn, known by its header: shown once, as the peer's. Terminal turns have no time, so
 *  messages follow them */
export function mergeChat(
  turns: SessionTurn[],
  messages: AgentMessage[],
  agentId: string,
): SessionBubble[] {
  const headers = messages
    .filter((m) => m.toAgentId === agentId)
    .flatMap((m) => injectedHeaders(m.id));
  const bubbles: SessionBubble[] = [];
  let next = 0;
  const messagesUntil = (at: number) => {
    for (; (messages[next]?.createdAt ?? Number.POSITIVE_INFINITY) <= at; next++) {
      const message = messages[next] as AgentMessage;
      bubbles.push({ kind: "peer", id: `peer:${message.id}`, message });
    }
  };
  for (const turn of turns) {
    if (turn.role === "user" && headers.some((h) => turn.text.startsWith(h))) continue;
    if (turn.at !== null) messagesUntil(turn.at);
    const last = bubbles.at(-1);
    if (turn.role !== "tool") {
      bubbles.push({ kind: "turn", id: turn.id, role: turn.role, text: turn.text, at: turn.at });
    } else if (last?.kind === "tools") {
      last.names.push(turn.text);
    } else {
      bubbles.push({ kind: "tools", id: turn.id, names: [turn.text] });
    }
  }
  messagesUntil(Number.MAX_SAFE_INTEGER);
  return bubbles;
}

/** "Read x3, Bash", in the order first used */
export function toolsLine(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 ? `${name} x${n}` : name)).join(", ");
}

export function chatSummary(turns: SessionTurn[], where: string, status: AgentStatus): string {
  const last = turns.findLast((t) => t.role === "assistant");
  return [where, `Status: ${status}`, ...(last ? ["", last.text] : [])].join("\n");
}
