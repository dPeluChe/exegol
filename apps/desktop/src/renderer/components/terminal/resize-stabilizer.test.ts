import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResizeStabilizer, RESIZE_STABLE_MS } from "./resize-stabilizer";

describe("createResizeStabilizer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends only the last size of a burst", () => {
    const send = vi.fn();
    const s = createResizeStabilizer(send);
    const view = {};
    s.request("a", view, 100, 30);
    vi.advanceTimersByTime(40);
    s.request("a", view, 108, 54);
    vi.advanceTimersByTime(RESIZE_STABLE_MS - 1);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledExactlyOnceWith("a", 108, 54);
  });

  it("a flap back to the size already sent sends nothing", () => {
    const send = vi.fn();
    const s = createResizeStabilizer(send);
    const view = {};
    s.request("a", view, 108, 54);
    vi.advanceTimersByTime(RESIZE_STABLE_MS);
    s.request("a", view, 102, 54);
    s.request("a", view, 108, 54);
    vi.advanceTimersByTime(RESIZE_STABLE_MS * 2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("the same size as the pending one does not restart the wait", () => {
    const send = vi.fn();
    const s = createResizeStabilizer(send);
    s.request("a", {}, 90, 20);
    vi.advanceTimersByTime(RESIZE_STABLE_MS - 10);
    s.request("a", {}, 90, 20);
    vi.advanceTimersByTime(10);
    expect(send).toHaveBeenCalledOnce();
  });

  it("a grid noted from main replaces the last sent one", () => {
    const send = vi.fn();
    const s = createResizeStabilizer(send);
    s.request("a", {}, 102, 54);
    vi.advanceTimersByTime(RESIZE_STABLE_MS);
    s.noteSize("a", 66, 10);
    s.request("a", {}, 102, 54);
    vi.advanceTimersByTime(RESIZE_STABLE_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("a view leaving cancels its own pending size, never another view's", () => {
    const send = vi.fn();
    const s = createResizeStabilizer(send);
    const pane = {};
    const card = {};
    s.request("a", pane, 66, 10);
    expect(s.cancel("a", pane)).toBe(true);
    vi.advanceTimersByTime(RESIZE_STABLE_MS * 2);
    expect(send).not.toHaveBeenCalled();

    s.request("a", card, 80, 24);
    expect(s.cancel("a", pane)).toBe(false);
    vi.advanceTimersByTime(RESIZE_STABLE_MS);
    expect(send).toHaveBeenCalledWith("a", 80, 24);
  });

  it("keeps sessions apart", () => {
    const send = vi.fn();
    const s = createResizeStabilizer(send);
    s.request("a", {}, 10, 10);
    s.request("b", {}, 20, 20);
    vi.advanceTimersByTime(RESIZE_STABLE_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
