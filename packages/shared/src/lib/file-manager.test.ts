import { describe, expect, it } from "vitest";
import { fileManagerName, linuxFileManagerName } from "./file-manager";

describe("fileManagerName", () => {
  it("names each platform's file manager", () => {
    expect(fileManagerName("darwin")).toBe("Finder");
    expect(fileManagerName("win32")).toBe("File Explorer");
    expect(fileManagerName("linux")).toBe("Files");
    expect(fileManagerName("linux", "Dolphin")).toBe("Dolphin");
    expect(fileManagerName("darwin", "Dolphin")).toBe("Finder");
  });
});

describe("linuxFileManagerName", () => {
  it("maps xdg-mime desktop ids", () => {
    expect(linuxFileManagerName("org.gnome.Nautilus.desktop\n")).toBe("Files");
    expect(linuxFileManagerName("org.kde.dolphin.desktop")).toBe("Dolphin");
    expect(linuxFileManagerName("nemo.desktop")).toBe("Nemo");
    expect(linuxFileManagerName("thunar.desktop")).toBe("Thunar");
    expect(linuxFileManagerName("pcmanfm-qt.desktop")).toBe("PCManFM-Qt");
  });

  it("returns null for unknown or empty ids", () => {
    expect(linuxFileManagerName("")).toBeNull();
    expect(linuxFileManagerName("code.desktop")).toBeNull();
  });
});
