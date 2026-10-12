import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describePidFile } from "./pty-sidecar-discovery";
import { ACTIVE_RING_FLOOR_BYTES, planTrims } from "./pty-sidecar-eviction";
import { createSidecarLog, formatLogLine, needsRotation, scrubHome } from "./sidecar-log";
import { framesAfter, isFrameGap, isStaleFrame, lostFrames } from "./sidecar-resync";

describe("output seq (T202)", () => {
  it("a frame at or before the last applied one is stale", () => {
    expect(isStaleFrame(5, 5)).toBe(true);
    expect(isStaleFrame(5, 4)).toBe(true);
    expect(isStaleFrame(5, 6)).toBe(false);
    expect(isStaleFrame(undefined, 1)).toBe(false);
    expect(isStaleFrame(5, undefined)).toBe(false);
  });

  it("a skipped seq is a gap", () => {
    expect(isFrameGap(5, 7)).toBe(true);
    expect(isFrameGap(5, 6)).toBe(false);
    expect(isFrameGap(undefined, 9)).toBe(false);
  });

  it("after a swap only a session behind the sidecar, or with a gap, lost frames", () => {
    expect(lostFrames(7, 7, false)).toBe(false);
    expect(lostFrames(6, 7, false)).toBe(true);
    expect(lostFrames(7, 7, true)).toBe(true);
    expect(lostFrames(undefined, 7, false)).toBe(true);
    expect(lostFrames(7, undefined, false)).toBe(true);
  });

  it("held frames after the ring's seq are replayed, the rest dropped", () => {
    const held = [
      { data: "a", seq: 3 },
      { data: "b", seq: 4 },
      { data: "c", seq: 5 },
    ];
    expect(framesAfter(held, 4).map((f) => f.data)).toEqual(["c"]);
    expect(framesAfter(held, undefined)).toEqual(held);
  });
});

describe("ring trims under memory pressure (T202)", () => {
  const MB = 1024 * 1024;
  it("shrinks the largest active rings to the floor until the total fits", () => {
    const rings = [
      { id: "shell", capacity: 1 * MB },
      { id: "a", capacity: 8 * MB },
      { id: "b", capacity: 8 * MB },
      { id: "c", capacity: 4 * MB },
    ];
    const trims = planTrims(rings, 21 * MB, 12 * MB);
    expect(trims).toEqual([
      { id: "a", before: 8 * MB, after: ACTIVE_RING_FLOOR_BYTES },
      { id: "b", before: 8 * MB, after: ACTIVE_RING_FLOOR_BYTES },
    ]);
  });

  it("never touches a ring at or under the floor, and nothing when under the cap", () => {
    expect(planTrims([{ id: "s", capacity: 2 * MB }], 300 * MB, 256 * MB)).toEqual([]);
    expect(planTrims([{ id: "a", capacity: 8 * MB }], 8 * MB, 256 * MB)).toEqual([]);
  });
});

describe("sidecar.log (T202)", () => {
  it("rotates once a line would pass the cap, keeping one .1", () => {
    expect(needsRotation(0, 500, 100)).toBe(false);
    expect(needsRotation(90, 20, 100)).toBe(true);
    expect(needsRotation(50, 20, 100)).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "sidecar-log-"));
    const path = join(dir, "sidecar.log");
    const at = () => new Date("2026-10-12T10:00:00Z");
    const log = createSidecarLog(path, "Sidecar", 120, at);
    log("first line of the old file");
    log("second line of the old file");
    log("third line");
    expect(readFileSync(`${path}.1`, "utf-8")).toBe(
      formatLogLine(at(), "Sidecar", "first line of the old file"),
    );
    const current = readFileSync(path, "utf-8");
    expect(current).toContain("second line");
    expect(current).toContain("third line");
    log("x".repeat(40));
    expect(readFileSync(`${path}.1`, "utf-8")).toContain("second line");
  });

  it("formats with time and source, and scrubs the home folder", () => {
    expect(formatLogLine(new Date("2026-10-12T10:00:00Z"), "Sidecar", "start")).toBe(
      "2026-10-12T10:00:00.000Z [Sidecar] start\n",
    );
    expect(scrubHome("listen EADDRINUSE /Users/me/.exegol/s.sock", "/Users/me")).toBe(
      "listen EADDRINUSE ~/.exegol/s.sock",
    );
  });

  it("never throws when the file cannot be written", () => {
    const dir = mkdtempSync(join(tmpdir(), "sidecar-log-"));
    const blocker = join(dir, "file");
    writeFileSync(blocker, "");
    const log = createSidecarLog(join(blocker, "sidecar.log"), "Sidecar");
    expect(() => log("x")).not.toThrow();
  });

  it("describes the pid file discovery found", () => {
    expect(describePidFile(null, false)).toBe("pid file: none");
    expect(describePidFile({ pid: 42, token: "t", version: "1.6.0", sock: "/s" }, true)).toBe(
      "pid file: pid 42 (alive), version 1.6.0",
    );
  });
});
