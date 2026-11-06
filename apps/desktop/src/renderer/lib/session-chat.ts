import {
  type AgentMessage,
  type AgentStatus,
  type ChatPage,
  injectedMessageId,
  type OlderChatPage,
  type SessionTurn,
} from "@exegol/shared";

export type ChatHistory = Omit<ChatPage, "reset">;

export type SessionBubble =
  | { kind: "turn"; id: string; role: "user" | "assistant"; text: string; at: number | null }
  | { kind: "tools"; id: string; names: string[] }
  | { kind: "peer"; id: string; message: AgentMessage };

/** The same object when a poll brought nothing new: the chat need not redraw */
export function appendChatPage(prev: ChatHistory | undefined, page: ChatPage): ChatHistory {
  const { cursor, fromTerminal, markdown } = page;
  if (!prev || page.reset)
    return { turns: page.turns, cursor, fromTerminal, markdown, older: page.older };
  const nothingNew =
    page.turns.length === 0 &&
    cursor === prev.cursor &&
    fromTerminal === prev.fromTerminal &&
    markdown === prev.markdown;
  if (nothingNew) return prev;
  const turns = page.turns.length === 0 ? prev.turns : [...prev.turns, ...page.turns];
  return { turns, cursor, fromTerminal, markdown, older: prev.older };
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

export function sameBubble(a: SessionBubble, b: SessionBubble): boolean {
  if (a.kind === "turn" && b.kind === "turn") {
    return a.id === b.id && a.role === b.role && a.text === b.text && a.at === b.at;
  }
  if (a.kind === "tools" && b.kind === "tools") {
    return a.id === b.id && a.names.join("\n") === b.names.join("\n");
  }
  return a.kind === "peer" && b.kind === "peer" && a.message === b.message;
}

/** "14:05", with the day once it is not today */
export function chatTime(at: number, now = new Date()): string {
  const date = new Date(at * 1000);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** Turns in file order, `messages` (oldest first) by time. A message typed into this session is
 *  also a turn, known by its header whether or not its row is among `messages`: shown once, as the
 *  peer's. One this session sent stays a turn. Terminal turns have no time, so messages follow */
export function mergeChat(
  turns: SessionTurn[],
  messages: AgentMessage[],
  agentId: string,
): SessionBubble[] {
  const sent = new Set(messages.filter((m) => m.toAgentId !== agentId).map((m) => m.id));
  const injected = (text: string) => {
    const id = injectedMessageId(text);
    return id !== null && !sent.has(id);
  };
  const bubbles: SessionBubble[] = [];
  let next = 0;
  const messagesUntil = (at: number) => {
    for (; (messages[next]?.createdAt ?? Number.POSITIVE_INFINITY) <= at; next++) {
      const message = messages[next] as AgentMessage;
      bubbles.push({ kind: "peer", id: `peer:${message.id}`, message });
    }
  };
  for (const turn of turns) {
    if (turn.role === "user" && injected(turn.text)) continue;
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
