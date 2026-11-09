import type { SessionTurn } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { liveReply } from "./live-reply";

const turn = (id: string, role: SessionTurn["role"]): SessionTurn => ({
  id,
  role,
  text: id,
  at: null,
});

describe("liveReply", () => {
  const backlog = [turn("u1", "user"), turn("a1", "assistant")];
  const seen = new Set(backlog.map((t) => t.id));

  it("never reads the backlog the chat opened with", () => {
    expect(liveReply(backlog, seen, null)).toBeNull();
  });

  it("reads a reply that arrived live, once", () => {
    const turns = [...backlog, turn("u2", "user"), turn("t1", "tool"), turn("a2", "assistant")];
    expect(liveReply(turns, seen, null)?.id).toBe("a2");
    expect(liveReply(turns, seen, "a2")).toBeNull();
  });

  it("waits while the turn runs: the last turn is the person's or a tool call", () => {
    expect(liveReply([...backlog, turn("u2", "user")], seen, null)).toBeNull();
    const working = [...backlog, turn("u2", "user"), turn("a2", "assistant"), turn("t1", "tool")];
    expect(liveReply(working, seen, null)).toBeNull();
  });
});
