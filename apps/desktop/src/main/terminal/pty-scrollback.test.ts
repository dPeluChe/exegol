import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeadlessEmulator } from "./headless-emulator";
import { flushScrollbackSync } from "./pty-scrollback";
import type { Session } from "./pty-session-types";

const settle = () => new Promise((r) => setTimeout(r, 20));
const dirs: string[] = [];

function session(emulator: HeadlessEmulator): Session {
  const dir = mkdtempSync(join(tmpdir(), "exegol-scrollback-"));
  dirs.push(dir);
  return { id: "a1", emulator, scrollbackPath: join(dir, "a1.ansi") } as Session;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("scrollback flush dirty check", () => {
  it("serializes once per change: an idle session skips the snapshot", async () => {
    const emulator = new HeadlessEmulator(80, 24);
    const s = session(emulator);
    const snapshot = vi.spyOn(emulator, "snapshot");

    emulator.write("hello");
    await settle();
    flushScrollbackSync(s);
    flushScrollbackSync(s);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(readFileSync(s.scrollbackPath as string, "utf-8")).toContain("hello");

    emulator.write(" world");
    await settle();
    flushScrollbackSync(s);
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(readFileSync(s.scrollbackPath as string, "utf-8")).toContain("hello world");

    emulator.resize(100, 30);
    flushScrollbackSync(s);
    expect(snapshot).toHaveBeenCalledTimes(3);
    emulator.dispose();
  });

  it("hasContent is false until output arrives, and a resize is not output", () => {
    const emulator = new HeadlessEmulator(80, 24);
    emulator.resize(120, 40);
    expect(emulator.hasContent).toBe(false);
    emulator.write("$ ");
    expect(emulator.hasContent).toBe(true);
    emulator.dispose();
  });
});
