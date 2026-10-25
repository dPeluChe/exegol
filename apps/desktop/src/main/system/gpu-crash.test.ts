import { describe, expect, it } from "vitest";
import {
  createGpuCrashTracker,
  describeGpu,
  describeGpuCrash,
  describeGpuRepaint,
  parseGpuRepaint,
  parseGpuStats,
} from "./gpu-crash";

const MIN = 60_000;

describe("createGpuCrashTracker", () => {
  it("switches to the DOM renderer on the third crash within 10 minutes", () => {
    const tracker = createGpuCrashTracker();
    expect(tracker.record(0).switched).toBe(false);
    expect(tracker.record(4 * MIN).switched).toBe(false);
    expect(tracker.record(9 * MIN)).toEqual({ recent: 3, switched: true });
    expect(tracker.isDomOnly()).toBe(true);
    expect(tracker.record(9.5 * MIN).switched).toBe(false);
  });

  it("does not count crashes older than the window", () => {
    const tracker = createGpuCrashTracker();
    tracker.record(0);
    tracker.record(5 * MIN);
    expect(tracker.record(11 * MIN)).toEqual({ recent: 2, switched: false });
    expect(tracker.isDomOnly()).toBe(false);
  });
});

describe("parseGpuStats", () => {
  it("accepts counts and rejects anything else", () => {
    expect(parseGpuStats({ views: 3, webgl: 2, capped: false })).toEqual({
      views: 3,
      webgl: 2,
      capped: false,
    });
    expect(parseGpuStats({ views: -1, webgl: 2, capped: false })).toBeNull();
    expect(parseGpuStats({ views: 1.5, webgl: 2, capped: false })).toBeNull();
    expect(parseGpuStats({ views: 1, webgl: 2 })).toBeNull();
    expect(parseGpuStats("x")).toBeNull();
  });
});

describe("describeGpuCrash", () => {
  const stats = [
    { views: 4, webgl: 3, capped: false },
    { views: 1, webgl: 1, capped: false },
  ];

  it("sums the windows' counts and names a recent sleep or display change", () => {
    expect(describeGpuCrash(2, stats, { name: "resume", at: 1_000 }, 31_000)).toBe(
      "2 window(s), 5 terminal view(s), 4 WebGL context(s), resume 30s before",
    );
  });

  it("leaves out an old event", () => {
    expect(describeGpuCrash(1, [], { name: "resume", at: 0 }, 10 * MIN)).toBe(
      "1 window(s), 0 terminal view(s), 0 WebGL context(s), no sleep or display change in the last 2 min",
    );
  });
});

describe("describeGpu", () => {
  it("names the active device's vendor and driver, and the features that matter", () => {
    const info = {
      gpuDevice: [
        { active: false, vendorId: 0x8086, deviceId: 0x3e9b },
        {
          active: true,
          vendorId: 0x10de,
          deviceId: 0x1234,
          driverVendor: "NVIDIA",
          driverVersion: "31.0",
        },
      ],
      machineModelName: "MacBookPro",
    };
    const features = {
      webgl: "enabled",
      webgl2: "enabled",
      gpu_compositing: "enabled",
      video_decode: "disabled_software",
      rasterization: "enabled",
    };
    const line = describeGpu(info, features);
    expect(line).toBe(
      "GPU NVIDIA, driver NVIDIA 31.0; gpu_compositing=enabled video_decode=disabled_software webgl=enabled webgl2=enabled",
    );
    expect(line).not.toContain("1234");
    expect(line).not.toContain("MacBook");
  });

  it("copes with no info at all", () => {
    expect(describeGpu(null, null)).toBe("GPU unknown");
  });
});

describe("parseGpuRepaint", () => {
  it("accepts the four counts with at least one view and rejects anything else", () => {
    const report = { views: 15, before: 8, afterDrop: 0, rebuilt: 2 };
    expect(parseGpuRepaint(report)).toEqual(report);
    expect(parseGpuRepaint({ ...report, views: 0 })).toBeNull();
    expect(parseGpuRepaint({ ...report, afterDrop: -1 })).toBeNull();
    expect(parseGpuRepaint({ ...report, rebuilt: 1.5 })).toBeNull();
    expect(parseGpuRepaint({ views: 3, before: 1, afterDrop: 0 })).toBeNull();
    expect(parseGpuRepaint(3)).toBeNull();
  });
});

describe("describeGpuRepaint", () => {
  it("names the addons at each step", () => {
    expect(describeGpuRepaint({ views: 15, before: 8, afterDrop: 0, rebuilt: 2 })).toBe(
      "GPU process restarted: repainting 15 terminal view(s), WebGL addons 8 before, 0 after the drop, 2 rebuilt",
    );
  });

  it("flags an addon that outlived the drop: the shared glyph atlas stays blank", () => {
    const line = describeGpuRepaint({ views: 3, before: 3, afterDrop: 1, rebuilt: 3 });
    expect(line).toContain("1 after the drop");
    expect(line).toContain("blank glyph atlas");
  });
});
