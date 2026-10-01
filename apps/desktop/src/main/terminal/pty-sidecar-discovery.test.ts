import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isOurSidecar } from "./pty-sidecar-discovery";

describe("isOurSidecar (T184.4)", () => {
  it("refuses a live process that is not the sidecar", async () => {
    expect(await isOurSidecar(process.pid)).toBe(false);
  });

  it("refuses a pid nothing runs under", async () => {
    expect(await isOurSidecar(2 ** 22 + 7)).toBe(false);
  });

  it("recognises a process running the sidecar entry", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "setTimeout(() => {}, 5000)",
      "pty-sidecar-entry.js",
    ]);
    try {
      expect(await isOurSidecar(child.pid as number)).toBe(true);
    } finally {
      child.kill();
    }
  });
});
