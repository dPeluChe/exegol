import type { ChatPage, ChatPeerMessage, ChatTurn } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import {
  appendChatPage,
  type ChatBubble,
  MAX_CHAT_TURNS,
  mergeChat,
  sendDecision,
  toolsLine,
} from "./session-chat";

const turn = (
  id: string,
  role: ChatTurn["role"],
  text: string,
  at: number | null = 10,
): ChatTurn => ({
  id,
  role,
  text,
  at,
});
const peer = (id: string, at: number, text = "hello", incoming = true): ChatPeerMessage => ({
  id,
  incoming,
  peer: "Scout",
  text,
  at,
  delivery: "delivered",
});
const ids = (bubbles: ChatBubble[]) => bubbles.map((b) => b.id);

describe("appendChatPage", () => {
  const page = (turns: ChatTurn[], reset: boolean): ChatPage => ({
    turns,
    cursor: "1:2",
    reset,
    source: "transcript",
    peers: [],
  });

  it("appends a tail, replaces on reset and keeps the last turns", () => {
    const first = appendChatPage(undefined, page([turn("a", "user", "x")], true));
    expect(appendChatPage(first, page([turn("b", "user", "y")], false)).turns).toHaveLength(2);
    expect(appendChatPage(first, page([turn("b", "user", "y")], true)).turns).toHaveLength(1);
    const many = Array.from({ length: MAX_CHAT_TURNS + 5 }, (_, i) => turn(`${i}`, "user", "x"));
    const capped = appendChatPage(first, page(many, false)).turns;
    expect(capped).toHaveLength(MAX_CHAT_TURNS);
    expect(capped.at(-1)?.id).toBe(`${MAX_CHAT_TURNS + 4}`);
  });
});

describe("mergeChat", () => {
  it("places peers by time", () => {
    const bubbles = mergeChat(
      [turn("a", "user", "one", 10), turn("b", "assistant", "two", 30)],
      [peer("p", 20), peer("q", 40)],
    );
    expect(ids(bubbles)).toEqual(["a", "peer:p", "b", "peer:q"]);
  });

  it("shows a typed peer message once, even wrapped", () => {
    const bubbles = mergeChat(
      [turn("a", "user", "[from Scout] hello there", 30)],
      [peer("p", 20, "hello there")],
    );
    expect(ids(bubbles)).toEqual(["peer:p"]);
  });

  it("leaves a turn alone when the same text was only sent out", () => {
    const bubbles = mergeChat([turn("a", "user", "hello", 30)], [peer("p", 20, "hello", false)]);
    expect(ids(bubbles)).toEqual(["peer:p", "a"]);
  });

  it("joins consecutive tools into one line and keeps peers after terminal text", () => {
    const bubbles = mergeChat(
      [
        turn("a", "tool", "Read", null),
        turn("b", "tool", "Read", null),
        turn("c", "assistant", "x", null),
      ],
      [peer("p", 5)],
    );
    expect(bubbles[0]).toMatchObject({ kind: "tools", names: ["Read", "Read"] });
    expect(ids(bubbles)).toEqual(["a", "c", "peer:p"]);
  });
});

describe("toolsLine", () => {
  it("counts repeats in the order first used", () => {
    expect(toolsLine(["Read", "Bash", "Read"])).toBe("Read x2, Bash");
  });
});

describe("sendDecision", () => {
  const base = { accepts: true, asks: false };

  it("sends at the prompt and queues while busy", () => {
    expect(sendDecision({ ...base, status: "waiting_input" })).toBe("send");
    expect(sendDecision({ ...base, status: "running" })).toBe("queue");
  });

  it("never sends over a question or to an ended session", () => {
    expect(sendDecision({ ...base, status: "waiting_input", asks: true })).toBe("question");
    expect(sendDecision({ ...base, status: "completed", accepts: false, asks: true })).toBe(
      "closed",
    );
  });
});
