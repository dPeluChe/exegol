import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CARD_FONT, migrateWatchStore, useWatchStore } from "./watch";

beforeEach(() => useWatchStore.setState({ watched: [], open: [], cardFont: {} }));

describe("pinning a session to Watching", () => {
  it("opens as a plain mirror: the session's width is not touched", () => {
    useWatchStore.getState().toggleWatch("a1");
    expect(useWatchStore.getState().cardFont.a1).toBeUndefined();
  });

  it("fitting it to the card starts from the default font", () => {
    useWatchStore.getState().toggleWatch("a1");
    useWatchStore.getState().setCardFont("a1", DEFAULT_CARD_FONT);
    expect(useWatchStore.getState().cardFont.a1).toBe(DEFAULT_CARD_FONT);
  });

  it("unpinning drops its font", () => {
    useWatchStore.getState().toggleWatch("a1");
    useWatchStore.getState().setCardFont("a1", 15);
    useWatchStore.getState().toggleWatch("a1");
    expect(useWatchStore.getState().cardFont.a1).toBeUndefined();
  });
});

describe("upgrading from 0.5.8", () => {
  it("turns the cards 0.5.8 sized by default back into plain mirrors, keeping the pins", () => {
    const old = { watched: ["a1"], open: ["a1"], columns: 1, cardFont: { a1: 13 } };
    expect(migrateWatchStore(old, 0)).toEqual({ ...old, cardFont: {} });
    expect(migrateWatchStore(old, 1)).toBe(old);
  });
});
