import { describe, expect, it } from "vitest";
import { paneZoomKey, screenshotFileName, stepZoom, zoomPercent } from "./browser-zoom";

const key = (over: Partial<Parameters<typeof paneZoomKey>[0]>) => ({
  meta: false,
  control: false,
  shift: false,
  alt: false,
  code: "",
  key: "",
  ...over,
});

describe("stepZoom", () => {
  it("walks Chrome's steps", () => {
    expect(stepZoom(1, "in")).toBe(1.1);
    expect(stepZoom(1, "out")).toBe(0.9);
    expect(stepZoom(0.67, "out")).toBe(0.5);
    expect(stepZoom(2.5, "reset")).toBe(1);
  });

  it("stops at the ends", () => {
    expect(stepZoom(3, "in")).toBe(3);
    expect(stepZoom(0.25, "out")).toBe(0.25);
  });

  it("snaps a factor between steps to the next one in that direction", () => {
    expect(stepZoom(1.2, "in")).toBe(1.25);
    expect(stepZoom(1.2, "out")).toBe(1.1);
  });

  it("shows whole percents", () => {
    expect(zoomPercent(0.33)).toBe(33);
    expect(zoomPercent(1.1)).toBe(110);
  });
});

describe("paneZoomKey", () => {
  it("reads Cmd+= / Cmd+- / Cmd+0 on macOS", () => {
    expect(paneZoomKey(key({ meta: true, code: "Equal", key: "=" }), true)).toBe("in");
    expect(paneZoomKey(key({ meta: true, shift: true, code: "Equal", key: "+" }), true)).toBe("in");
    expect(paneZoomKey(key({ meta: true, code: "Minus", key: "-" }), true)).toBe("out");
    expect(paneZoomKey(key({ meta: true, code: "Digit0", key: "0" }), true)).toBe("reset");
  });

  it("leaves Cmd+Shift+0 to the app and plain keys to the page", () => {
    expect(paneZoomKey(key({ meta: true, shift: true, code: "Digit0" }), true)).toBeNull();
    expect(paneZoomKey(key({ code: "Equal", key: "=" }), true)).toBeNull();
    expect(paneZoomKey(key({ control: true, code: "Equal", key: "=" }), true)).toBeNull();
  });

  it("uses Ctrl+Shift off macOS", () => {
    const chord = { control: true, shift: true };
    expect(paneZoomKey(key({ ...chord, code: "Equal", key: "+" }), false)).toBe("in");
    expect(paneZoomKey(key({ ...chord, code: "Minus", key: "_" }), false)).toBe("out");
    expect(paneZoomKey(key({ ...chord, code: "Digit0", key: ")" }), false)).toBe("reset");
    expect(paneZoomKey(key({ control: true, code: "Equal", key: "=" }), false)).toBeNull();
  });
});

describe("screenshotFileName", () => {
  const date = new Date(2026, 9, 6, 9, 5);

  it("names the file after the host and the local time", () => {
    expect(screenshotFileName("http://localhost:5173/a?token=x", date)).toBe(
      "localhost-2026-10-06-0905.png",
    );
    expect(screenshotFileName("https://app.example.com/", date, "jpg")).toBe(
      "app.example.com-2026-10-06-0905.jpg",
    );
  });

  it("falls back when the URL has no host", () => {
    expect(screenshotFileName("about:blank", date)).toBe("page-2026-10-06-0905.png");
    expect(screenshotFileName("http://[::1]:3000/", date)).toBe("1-2026-10-06-0905.png");
  });
});
