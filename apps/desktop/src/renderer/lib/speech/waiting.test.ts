import { describe, expect, it } from "vitest";
import { addWaiting } from "./waiting";

const reply = (key: string) => ({ key, text: key, agentId: "a1" });

describe("addWaiting", () => {
  it("keeps the order, one place per reply, and drops the oldest past the limit", () => {
    const two = addWaiting(addWaiting([], reply("a")), reply("b"));
    expect(two.map((w) => w.key)).toEqual(["a", "b"]);
    expect(addWaiting(two, reply("a")).map((w) => w.key)).toEqual(["a", "b"]);
    expect(addWaiting(two, reply("c"), 2).map((w) => w.key)).toEqual(["b", "c"]);
  });
});
