import { describe, expect, it } from "vitest";
import { isRunnableFile } from "./runnable-ext";

describe("isRunnableFile", () => {
  it("keeps the macOS list", () => {
    expect(isRunnableFile("/a/Tool.app", "darwin")).toBe(true);
    expect(isRunnableFile("/a/run.command", "darwin")).toBe(true);
    expect(isRunnableFile("/a/index.js", "darwin")).toBe(false);
    expect(isRunnableFile("/a/doc.pdf", "darwin")).toBe(false);
  });

  it("covers Windows launchers and script hosts, any case", () => {
    for (const name of ["setup.EXE", "x.bat", "x.Cmd", "x.ps1", "x.vbs", "x.js", "x.lnk"]) {
      expect(isRunnableFile(`C:\\p\\${name}`, "win32")).toBe(true);
    }
    expect(isRunnableFile("C:\\p\\a.msi", "win32")).toBe(true);
    expect(isRunnableFile("C:\\p\\a.scr", "win32")).toBe(true);
    expect(isRunnableFile("C:\\p\\a.txt", "win32")).toBe(false);
  });

  it("covers Linux launchers and packages, any case", () => {
    for (const name of ["a.desktop", "a.deb", "a.rpm", "Tool.AppImage", "a.run", "a.fish"]) {
      expect(isRunnableFile(`/home/a/${name}`, "linux")).toBe(true);
    }
    expect(isRunnableFile("/home/a/notes.md", "linux")).toBe(false);
    expect(isRunnableFile("/home/a/Makefile", "linux")).toBe(false);
  });

  it("treats other platforms like Linux", () => {
    expect(isRunnableFile("/a/b.desktop", "freebsd")).toBe(true);
  });
});
