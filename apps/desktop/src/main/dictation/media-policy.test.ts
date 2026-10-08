import { describe, expect, it } from "vitest";
import { allowMediaRequest, type MediaRequest } from "./media-policy";

const base: MediaRequest = {
  permission: "media",
  mediaTypes: ["audio"],
  url: "file:///app/out/renderer/index.html",
  isMainWindow: true,
  appOrigin: "file://",
  armed: true,
};

describe("allowMediaRequest", () => {
  it("allows the main window's mic while a dictation starts", () => {
    expect(allowMediaRequest(base)).toBe(true);
  });

  it("denies a browser pane, a disarmed window, another origin and the camera", () => {
    expect(allowMediaRequest({ ...base, isMainWindow: false })).toBe(false);
    expect(allowMediaRequest({ ...base, armed: false })).toBe(false);
    expect(allowMediaRequest({ ...base, url: "https://example.com/" })).toBe(false);
    expect(allowMediaRequest({ ...base, mediaTypes: ["audio", "video"] })).toBe(false);
    expect(allowMediaRequest({ ...base, mediaTypes: [] })).toBe(false);
  });

  it("matches the dev server origin exactly", () => {
    const dev = { ...base, appOrigin: "http://localhost:5173" };
    expect(allowMediaRequest({ ...dev, url: "http://localhost:5173/?x=1" })).toBe(true);
    expect(allowMediaRequest({ ...dev, url: "http://localhost:5174/" })).toBe(false);
  });

  it("leaves other permissions to Electron's default", () => {
    expect(allowMediaRequest({ ...base, permission: "notifications", isMainWindow: false })).toBe(
      true,
    );
  });
});
