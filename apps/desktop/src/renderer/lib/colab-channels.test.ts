import type { InboxThread } from "@exegol/shared";
import { expect, it } from "vitest";
import { channelPending, channelThreads, PERSONAL } from "./colab-channels";

const thread = (id: string, scope: InboxThread["scope"], scopeId: string | null) =>
  ({ id, scope, scopeId, kind: "message", lastAuthorKind: "agent" }) as InboxThread;

it("keeps a project thread out of the colab whose id it shares, and says when one waits on the person", () => {
  const threads = [thread("inb_1", "colab", "c1"), thread("inb_2", "project", "c1")];
  expect(channelThreads(threads, "c1").map((t) => t.id)).toEqual(["inb_1"]);
  expect(channelPending([thread("inb_3", "personal", null)], PERSONAL)).toEqual({
    count: 1,
    needsYou: true,
  });
  expect(channelPending(threads, "none")).toEqual({ count: 0, needsYou: false });
});
