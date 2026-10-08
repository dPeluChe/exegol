import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  forwardDictationKeys,
  isPlainEnter,
  setDictationChord,
  setDictationListening,
} from "./keys";

const key = (k: string, extra: Partial<Electron.Input> = {}) =>
  ({ type: "keyDown", key: k, code: k, ...extra }) as Electron.Input;

function page() {
  const host = { send: vi.fn(), isDestroyed: () => false };
  let handler: (event: { preventDefault(): void }, input: Electron.Input) => void = () => {};
  const contents = {
    hostWebContents: host,
    on: (_name: string, fn: typeof handler) => {
      handler = fn;
    },
  } as unknown as WebContents;
  const press = (input: Electron.Input) => {
    const event = { preventDefault: vi.fn() };
    handler(event, input);
    return event.preventDefault.mock.calls.length > 0;
  };
  return { host, contents, press };
}

describe("isPlainEnter", () => {
  it("is a bare Enter outside an IME composition", () => {
    expect(isPlainEnter(key("Enter"))).toBe(true);
    expect(isPlainEnter(key("Enter", { isComposing: true }))).toBe(false);
    expect(isPlainEnter(key("Enter", { shift: true }))).toBe(false);
  });
});

describe("forwardDictationKeys", () => {
  setDictationChord({ code: "KeyD", cmd: true, ctrl: false, shift: true, alt: false });
  setDictationListening(() => true);

  it("forwards Enter and Esc while listening when the host is the main window", () => {
    const { host, contents, press } = page();
    forwardDictationKeys(contents, () => true);
    expect(press(key("Enter"))).toBe(true);
    expect(press(key("Escape"))).toBe(true);
    expect(host.send.mock.calls.map((c) => c[1].kind)).toEqual(["enter", "escape"]);
  });

  it("leaves Enter and Esc to a page hosted by another window", () => {
    const { host, contents, press } = page();
    forwardDictationKeys(contents, () => false);
    expect(press(key("Enter"))).toBe(false);
    expect(press(key("Escape"))).toBe(false);
    expect(host.send).not.toHaveBeenCalled();
  });

  it("leaves Enter alone during an IME composition", () => {
    const { host, contents, press } = page();
    forwardDictationKeys(contents, () => true);
    expect(press(key("Enter", { isComposing: true }))).toBe(false);
    expect(host.send).not.toHaveBeenCalled();
  });
});
