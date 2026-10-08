import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  forwardDictationEscape,
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
    const toMain = vi.fn();
    forwardDictationKeys(contents, () => true, toMain);
    expect(press(key("Enter"))).toBe(true);
    expect(press(key("Escape"))).toBe(true);
    expect(host.send.mock.calls.map((c) => c[1].kind)).toEqual(["enter"]);
    expect(toMain).toHaveBeenCalledWith({ kind: "escape" });
  });

  it("leaves Enter to a page hosted by another window, but its Esc still cancels in main", () => {
    const { host, contents, press } = page();
    const toMain = vi.fn();
    forwardDictationKeys(contents, () => false, toMain);
    expect(press(key("Enter"))).toBe(false);
    expect(press(key("Escape"))).toBe(true);
    expect(host.send).not.toHaveBeenCalled();
    expect(toMain).toHaveBeenCalledWith({ kind: "escape" });
  });

  it("leaves Enter alone during an IME composition", () => {
    const { host, contents, press } = page();
    forwardDictationKeys(contents, () => true);
    expect(press(key("Enter", { isComposing: true }))).toBe(false);
    expect(host.send).not.toHaveBeenCalled();
  });
});

describe("forwardDictationEscape", () => {
  function win() {
    let handler: (event: { preventDefault(): void }, input: Electron.Input) => void = () => {};
    const contents = {
      on: (_name: string, fn: typeof handler) => {
        handler = fn;
      },
    } as unknown as WebContents;
    const press = (input: Electron.Input) => {
      const event = { preventDefault: vi.fn() };
      handler(event, input);
      return event.preventDefault.mock.calls.length > 0;
    };
    return { contents, press };
  }

  it("Esc in another Exegol window (Settings, a floating pane) cancels the dictation", () => {
    setDictationListening(() => true);
    const { contents, press } = win();
    const toMain = vi.fn();
    forwardDictationEscape(contents, () => false, toMain);
    expect(press(key("Escape"))).toBe(true);
    expect(press(key("Enter"))).toBe(false);
    expect(press(key("Escape", { type: "keyUp" }))).toBe(false);
    expect(toMain).toHaveBeenCalledTimes(1);
    expect(toMain).toHaveBeenCalledWith({ kind: "escape" });
  });

  it("keeps the main window's Esc for its page and relays it; no dictation, no relay", () => {
    const { contents, press } = win();
    const toMain = vi.fn();
    forwardDictationEscape(contents, () => true, toMain);
    expect(press(key("Escape"))).toBe(false);
    expect(toMain).toHaveBeenCalledWith({ kind: "escape" });
    toMain.mockClear();
    setDictationListening(() => false);
    const other = win();
    forwardDictationEscape(other.contents, () => false, toMain);
    expect(other.press(key("Escape"))).toBe(false);
    expect(toMain).not.toHaveBeenCalled();
    setDictationListening(() => true);
  });
});
