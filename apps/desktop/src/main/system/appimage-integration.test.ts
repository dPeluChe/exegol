import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
const { appImageDesktopEntry } = await import("./appimage-integration");

describe("appImageDesktopEntry", () => {
  it("launches the AppImage, quoted and escaped, and takes exegol:// links", () => {
    const entry = appImageDesktopEntry('/home/u/Apps/My "Apps"/Exegol.AppImage', "/i/exegol.png");
    expect(entry).toContain('Exec="/home/u/Apps/My \\"Apps\\"/Exegol.AppImage" %U');
    expect(entry).toContain("Icon=/i/exegol.png");
    expect(entry).toContain("MimeType=x-scheme-handler/exegol;");
    expect(entry.startsWith("[Desktop Entry]\n")).toBe(true);
  });
});
