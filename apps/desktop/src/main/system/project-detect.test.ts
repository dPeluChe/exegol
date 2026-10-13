import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../ide/detect", () => ({
  detectIdes: async () => new Map([["cursor", { argv: ["cursor"], line: "goto" }]]),
}));

import { detectProject, fileManagerName, folderKinds, pickEditor } from "./project-detect";

describe("folderKinds", () => {
  it("reads git, Node scripts, Xcode and Swift packages", () => {
    expect(
      folderKinds(["App.xcodeproj", "Package.swift"], { scripts: { dev: "vite" } }, true),
    ).toEqual(["git", "node", "xcode", "swift"]);
    expect(folderKinds(["App.xcworkspace"], null, false)).toEqual(["xcode"]);
  });

  it("no scripts is not a Node folder", () => {
    expect(folderKinds(["package.json"], { scripts: {} }, false)).toEqual([]);
  });

  it("tells a prebuilt Expo app (native folders) from a managed one", () => {
    const pkg = { dependencies: { expo: "~52.0.0" } };
    expect(folderKinds(["ios", "app.json"], pkg, false)).toEqual(["expo-prebuilt"]);
    expect(folderKinds(["app.json"], { devDependencies: { expo: "52" } }, false)).toEqual([
      "expo-managed",
    ]);
  });
});

describe("pickEditor", () => {
  const installed = new Set(["cursor", "vscode"]);
  it("offers the chosen IDE only when installed", () => {
    expect(pickEditor("cursor", installed, null)).toEqual({ id: "cursor", label: "Cursor" });
    expect(pickEditor("zed", installed, null)).toBeNull();
  });
  it("nothing set, no editor", () => {
    expect(pickEditor(null, installed, null)).toBeNull();
  });
  it("a custom editor needs its path", () => {
    expect(pickEditor("custom", installed, "/usr/local/bin/hx")).toEqual({
      id: "custom",
      label: "hx",
    });
    expect(pickEditor("custom", installed, null)).toBeNull();
  });
});

describe("fileManagerName", () => {
  it("names the platform's", () => {
    expect(fileManagerName("darwin")).toBe("Finder");
    expect(fileManagerName("win32")).toBe("Explorer");
    expect(fileManagerName("linux")).toBe("File manager");
  });
});

describe("detectProject", () => {
  it("lists the root first with each folder's kinds and the installed editor", async () => {
    const root = mkdtempSync(join(tmpdir(), "exegol-detect-"));
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "mobile", "ios"), { recursive: true });
    writeFileSync(
      join(root, "mobile", "package.json"),
      JSON.stringify({ scripts: { start: "expo start" }, dependencies: { expo: "52" } }),
    );
    const detect = await detectProject({ projectPath: root, ide: "cursor", customIdePath: null });
    expect(detect.folders[0]?.rel).toBe("");
    expect(detect.folders[0]?.kinds).toEqual(["git"]);
    expect(detect.folders.find((f) => f.rel === "mobile")?.kinds).toEqual([
      "node",
      "expo-prebuilt",
    ]);
    expect(detect.editor?.id).toBe("cursor");
  });
});
