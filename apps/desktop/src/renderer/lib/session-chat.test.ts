import type { AgentMessage, ChatPage, SessionTurn } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import {
  appendChatPage,
  MAX_CHAT_TURNS,
  mergeChat,
  type SessionBubble,
  toolsLine,
} from "./session-chat";

const turn = (
  id: string,
  role: SessionTurn["role"],
  text: string,
  at: number | null = 10,
): SessionTurn => ({ id, role, text, at });
const SELF = "me";
const peer = (id: string, createdAt: number, incoming = true): AgentMessage => ({
  id,
  fromAgentId: incoming ? "scout" : SELF,
  toAgentId: incoming ? SELF : "scout",
  type: "text",
  content: "hello",
  createdAt,
  readAt: null,
  deliveryState: "delivered",
});
const ids = (bubbles: SessionBubble[]) => bubbles.map((b) => b.id);

describe("appendChatPage", () => {
  const page = (turns: SessionTurn[], reset: boolean): ChatPage => ({
    turns,
    cursor: "1:2",
    reset,
    fromTerminal: false,
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
      SELF,
    );
    expect(ids(bubbles)).toEqual(["a", "peer:p", "b", "peer:q"]);
  });

  it("shows a typed peer message once, by its header, short body or pointer", () => {
    const short = turn("a", "user", '[Exegol message p from agent "Scout" (id s)]\nok', 30);
    const pointer = turn("b", "user", '[Exegol notice q from "CI": x]\nThe body is 9000', 30);
    expect(ids(mergeChat([short, pointer], [peer("p", 20), peer("q", 21)], SELF))).toEqual([
      "peer:p",
      "peer:q",
    ]);
  });

  it("keeps a turn that only repeats a message's text, or quotes its header later", () => {
    const quoted = turn("a", "user", "see [Exegol message p from x", 30);
    expect(ids(mergeChat([turn("b", "user", "hello", 30), quoted], [peer("p", 20)], SELF))).toEqual(
      ["peer:p", "b", "a"],
    );
  });

  it("leaves a turn alone when the message was sent out", () => {
    const typed = turn("a", "user", "[Exegol message p from x", 30);
    expect(ids(mergeChat([typed], [peer("p", 20, false)], SELF))).toEqual(["peer:p", "a"]);
  });

  it("joins consecutive tools into one line and keeps peers after terminal text", () => {
    const bubbles = mergeChat(
      [
        turn("a", "tool", "Read", null),
        turn("b", "tool", "Read", null),
        turn("c", "assistant", "x", null),
      ],
      [peer("p", 5)],
      SELF,
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
