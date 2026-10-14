import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import { fitAndSyncSize } from "./terminal-setup";

const terminal = (width: number, height: number) =>
  ({
    cols: 80,
    rows: 24,
    element: { parentElement: { clientWidth: width, clientHeight: height } },
  }) as unknown as Terminal;

const addon = (dims: { cols: number; rows: number } | undefined) =>
  ({ proposeDimensions: () => dims, fit: vi.fn() }) as unknown as FitAddon & { fit: () => void };

describe("fitAndSyncSize", () => {
  it("fits nothing while the box or its cells are unmeasured, so the caller refits later", () => {
    const onSize = vi.fn();
    for (const [t, fit] of [
      [terminal(0, 0), addon({ cols: 100, rows: 30 })],
      [terminal(800, 600), addon(undefined)],
      [terminal(800, 600), addon({ cols: Number.NaN, rows: Number.NaN })],
    ] as const) {
      expect(fitAndSyncSize(t, fit, "a", true, onSize)).toBe(false);
      expect(fit.fit).not.toHaveBeenCalled();
    }
    expect(onSize).not.toHaveBeenCalled();
  });

  it("fits a measured box and reports its grid", () => {
    const onSize = vi.fn();
    const fit = addon({ cols: 100, rows: 30 });
    expect(fitAndSyncSize(terminal(800, 600), fit, "a", true, onSize)).toBe(true);
    expect(fit.fit).toHaveBeenCalledOnce();
    expect(onSize).toHaveBeenCalledWith(80, 24);
  });
});
