import { describe, expect, it } from "vitest";
import { webviewAppKey } from "./app-keys";

const input = (over: Partial<Parameters<typeof webviewAppKey>[0]>) => ({
  type: "keyDown",
  meta: false,
  control: true,
  shift: true,
  alt: false,
  key: "",
  code: "",
  ...over,
});

describe("webviewAppKey", () => {
  it("reads the app chords off macOS", () => {
    expect(webviewAppKey(input({ key: "T", code: "KeyT" }), "linux")).toBe("new-tab");
    expect(webviewAppKey(input({ key: "W", code: "KeyW" }), "win32")).toBe("close-pane");
    expect(webviewAppKey(input({ key: "L", code: "KeyL" }), "linux")).toBe("focus-location");
    expect(webviewAppKey(input({ key: "R", code: "KeyR" }), "linux")).toBe("reload");
    expect(webviewAppKey(input({ key: "Q", code: "KeyQ" }), "linux")).toBe("quit");
    expect(webviewAppKey(input({ alt: true, key: ")", code: "Digit0" }), "linux")).toBe(
      "reset-zoom",
    );
  });

  it("leaves macOS to its menu accelerators", () => {
    expect(webviewAppKey(input({ key: "T", code: "KeyT" }), "darwin")).toBeNull();
  });

  it("leaves the page its own keys", () => {
    expect(webviewAppKey(input({ shift: false, key: "t", code: "KeyT" }), "linux")).toBeNull();
    expect(webviewAppKey(input({ meta: true, key: "T", code: "KeyT" }), "linux")).toBeNull();
    expect(webviewAppKey(input({ alt: true, key: "T", code: "KeyT" }), "linux")).toBeNull();
    expect(webviewAppKey(input({ key: "X", code: "KeyX" }), "linux")).toBeNull();
    expect(webviewAppKey(input({ type: "keyUp", key: "T", code: "KeyT" }), "linux")).toBeNull();
  });
});
