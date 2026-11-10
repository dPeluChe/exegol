import { expect, it } from "vitest";
import { firstUnreadId } from "./commander-unread";
import type { SessionBubble } from "./session-chat";

const turn = (id: string, role: "user" | "assistant", at: number | null): SessionBubble => ({
  kind: "turn",
  id,
  role,
  text: id,
  at,
});

it("marks the first reply of the turns not read, never the person's own line", () => {
  const bubbles = [turn("a", "assistant", 5), turn("u", "user", 10), turn("b", "assistant", 12)];
  expect(firstUnreadId(bubbles, 10)).toBe("b");
  expect(firstUnreadId(bubbles, 20)).toBeNull();
  expect(firstUnreadId(bubbles, null)).toBeNull();
  expect(firstUnreadId([turn("t", "assistant", null)], 1)).toBeNull();
});
