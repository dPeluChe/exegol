import type { AgentMessage, ChatPage, SessionTurn } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import {
  appendChatPage,
  mergeChat,
  prependChatPage,
  type SessionBubble,
  sameBubble,
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
    markdown: true,
    older: "1:0",
  });

  it("appends a tail and replaces on reset", () => {
    const first = appendChatPage(undefined, page([turn("a", "user", "x")], true));
    expect(appendChatPage(first, page([turn("b", "user", "y")], false)).turns).toHaveLength(2);
    expect(appendChatPage(first, page([turn("b", "user", "y")], true)).turns).toHaveLength(1);
  });

  it("returns the same object for a tail with nothing new, but keeps a cursor that moved", () => {
    const first = appendChatPage(undefined, page([turn("a", "user", "x")], true));
    expect(appendChatPage(first, page([], false))).toBe(first);
    const moved = appendChatPage(first, { ...page([], false), cursor: "1:9" });
    expect(moved.cursor).toBe("1:9");
    expect(moved.turns).toBe(first.turns);
  });

  it("prepends older turns, unless the history was replaced since asking", () => {
    const held = appendChatPage(undefined, page([turn("b", "user", "y")], true));
    const older = { turns: [turn("a", "user", "x")], older: null };
    const joined = prependChatPage(held, older, "1:0");
    expect(joined.turns.map((t) => t.id)).toEqual(["a", "b"]);
    expect(joined.older).toBeNull();
    expect(prependChatPage(held, older, "9:9")).toBe(held);
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

  it("hides an injected turn whose message row is not loaded", () => {
    const old = turn("a", "user", '[Exegol message gone from agent "Scout" (id s)]\nok', 30);
    expect(ids(mergeChat([old, turn("b", "user", "hi", 31)], [], SELF))).toEqual(["b"]);
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

describe("sameBubble", () => {
  const turnBubble = (text: string): SessionBubble => ({
    kind: "turn",
    id: "a",
    role: "assistant",
    text,
    at: 1,
  });

  it("compares content, not the object mergeChat rebuilt", () => {
    expect(sameBubble(turnBubble("x"), turnBubble("x"))).toBe(true);
    expect(sameBubble(turnBubble("x"), turnBubble("y"))).toBe(false);
    const tools = (names: string[]): SessionBubble => ({ kind: "tools", id: "t", names });
    expect(sameBubble(tools(["Read"]), tools(["Read"]))).toBe(true);
    expect(sameBubble(tools(["Read"]), tools(["Read", "Bash"]))).toBe(false);
    expect(sameBubble(turnBubble("x"), tools(["x"]))).toBe(false);
  });
});
