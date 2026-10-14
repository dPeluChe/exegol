import { afterEach, describe, expect, it, vi } from "vitest";
import { createResizeStabilizer } from "./resize-stabilizer";

describe("createResizeStabilizer", () => {
  afterEach(() => vi.useRealTimers());

  it("sends only the size the box held for the whole wait", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const s = createResizeStabilizer(send, 150);
    const view = {};
    s.request("a", view, 108, 54);
    vi.advanceTimersByTime(100);
    s.request("a", view, 102, 54);
    vi.advanceTimersByTime(100);
    s.request("a", view, 108, 54);
    vi.advanceTimersByTime(149);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("a", 108, 54);
  });

  it("a view leaving cancels its own pending size, never another view's", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const s = createResizeStabilizer(send, 150);
    const pane = {};
    const card = {};
    s.request("a", pane, 66, 10);
    s.cancel("a", pane);
    vi.advanceTimersByTime(200);
    expect(send).not.toHaveBeenCalled();

    s.request("a", card, 80, 24);
    s.cancel("a", pane);
    vi.advanceTimersByTime(150);
    expect(send).toHaveBeenCalledWith("a", 80, 24);
    expect(s.has("a")).toBe(false);
  });

  it("keeps sessions apart", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const s = createResizeStabilizer(send, 150);
    s.request("a", {}, 10, 10);
    s.request("b", {}, 20, 20);
    vi.advanceTimersByTime(150);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
