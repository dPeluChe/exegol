import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CARD_FONT, useWatchStore } from "./watch";

beforeEach(() => useWatchStore.setState({ watched: [], open: [], cardFont: {} }));

describe("pinning a session to Watching", () => {
  it("opens it sized to its card at the default font", () => {
    useWatchStore.getState().toggleWatch("a1");
    expect(useWatchStore.getState().cardFont.a1).toBe(DEFAULT_CARD_FONT);
  });

  it("keeps a font the user already chose", () => {
    useWatchStore.setState({ cardFont: { a1: 17 } });
    useWatchStore.getState().toggleWatch("a1");
    expect(useWatchStore.getState().cardFont.a1).toBe(17);
  });

  it("unpinning drops its font", () => {
    useWatchStore.getState().toggleWatch("a1");
    useWatchStore.getState().toggleWatch("a1");
    expect(useWatchStore.getState().cardFont.a1).toBeUndefined();
  });
});
