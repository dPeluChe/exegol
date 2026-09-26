import { describe, expect, it, vi } from "vitest";
import { captureConsole, consoleTail } from "./console-capture";

function fakeContents(type: string, url = "file:///index.html") {
  const handlers: ((...a: unknown[]) => void)[] = [];
  return {
    getType: () => type,
    getURL: () => url,
    on: vi.fn((_: string, h: (...a: unknown[]) => void) => handlers.push(h)),
    emit: (...a: unknown[]) => {
      for (const h of handlers) h(...a);
    },
  };
}

describe("captureConsole", () => {
  it("records Exegol windows (both Electron event shapes) and skips debug", () => {
    const main = fakeContents("window");
    captureConsole(main as never);
    main.emit({
      level: "warning",
      message: "webgl context not restored; firing onContextLoss",
      sourceId: "file:///a/WebglRenderer.js",
      lineNumber: 118,
    });
    main.emit({}, 3, "Uncaught TypeError: x", 12, "file:///a/index.js");
    main.emit({ level: "debug", message: "noise" });
    const tail = consoleTail();
    expect(tail).toMatch(
      /\[WARNING\] \[main\] webgl context not restored; firing onContextLoss \(WebglRenderer\.js:118\)/,
    );
    expect(tail).toMatch(/\[ERROR\] \[main\] Uncaught TypeError: x \(index\.js:12\)/);
    expect(tail).not.toMatch(/noise/);
  });

  it("never records a browser pane (someone else's site)", () => {
    const webview = fakeContents("webview", "https://bank.example");
    captureConsole(webview as never);
    expect(webview.on).not.toHaveBeenCalled();
  });
});
