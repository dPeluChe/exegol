import { describe, expect, it, vi } from "vitest";
import { trackMousePress } from "./mouse-release";

// Node's EventTarget keeps a capture listener after removeEventListener(type, fn, true)
class Target {
  private listeners = new Map<string, Set<(ev: Event) => void>>();
  addEventListener(type: string, fn: (ev: Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }
  removeEventListener(type: string, fn: (ev: Event) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatchEvent(ev: Event) {
    for (const fn of [...(this.listeners.get(ev.type) ?? [])]) fn(ev);
    return true;
  }
}

function setup() {
  const element = new Target() as unknown as EventTarget;
  const doc = new Target() as unknown as EventTarget;
  // Stands in for xterm: a press adds a document listener, a release removes it
  const pending = vi.fn();
  element.addEventListener("mousedown", () => {
    const onUp = () => {
      pending();
      doc.removeEventListener("mouseup", onUp);
    };
    doc.addEventListener("mouseup", onUp);
  });
  const tracker = trackMousePress(element, doc, () => new Event("mouseup"));
  return { element, doc, pending, tracker };
}

describe("trackMousePress", () => {
  it("delivers the release a press disposed mid-way is waiting for", () => {
    const { element, doc, pending, tracker } = setup();
    element.dispatchEvent(new Event("mousedown"));
    tracker.release();
    expect(pending).toHaveBeenCalledTimes(1);
    doc.dispatchEvent(new Event("mouseup"));
    expect(pending).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when no press is open", () => {
    const { element, doc, tracker } = setup();
    const seen = vi.fn();
    element.dispatchEvent(new Event("mousedown"));
    doc.dispatchEvent(new Event("mouseup"));
    doc.addEventListener("mouseup", seen);
    tracker.release();
    expect(seen).not.toHaveBeenCalled();
  });

  it("stops tracking after release", () => {
    const { element, doc, tracker } = setup();
    tracker.release();
    const seen = vi.fn();
    doc.addEventListener("mouseup", seen);
    element.dispatchEvent(new Event("mousedown"));
    tracker.release();
    expect(seen).not.toHaveBeenCalled();
  });
});
