import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/event-bus", () => ({ broadcast: vi.fn() }));

import { broadcast } from "../lib/event-bus";
import { HeadlessEmulator } from "./headless-emulator";
import { PtyHost } from "./pty-host";
import type { SidecarClient } from "./pty-sidecar-client";
import { REPAINT_CAP_MS, REPAINT_QUIET_MS } from "./reattach-repaint";

function fakeSidecar() {
  const resize = vi.fn(async () => {});
  const client = {
    isConnected: () => true,
    snapshot: async () => "",
    resize,
    onSessionData: () => {},
    onSessionExit: () => {},
    onSessionError: () => {},
  } as unknown as SidecarClient;
  return { client, resize };
}

const callbacks = { onData: () => {}, onExit: () => {} } as never;

describe("PtyHost resize", () => {
  afterEach(() => vi.useRealTimers());

  it("applies a size requested before the session reattached", async () => {
    // A pane mounts and fits before reattach finishes; that size was dropped
    const host = new PtyHost();
    const { client, resize } = fakeSidecar();
    host.connectToSidecar(client);
    host.resize("a", 200, 50);
    expect(resize).not.toHaveBeenCalled();
    await host.reattachSession("a", { cols: 120, rows: 30 }, callbacks);
    expect(resize).toHaveBeenCalledWith("a", 200, 50);
    expect(host.getSize("a")).toEqual({ cols: 200, rows: 50 });
    expect(broadcast).toHaveBeenCalledWith("terminal:resized", "a", 200, 50);
  });

  it("redraw jiggles the PTY and restores its real size without moving the model", async () => {
    vi.useFakeTimers();
    const host = new PtyHost();
    const { client, resize } = fakeSidecar();
    host.connectToSidecar(client);
    await host.reattachSession("b", { cols: 100, rows: 40 }, callbacks);
    resize.mockClear();
    host.redraw("b");
    expect(resize).toHaveBeenLastCalledWith("b", 99, 40);
    expect(host.getSize("b")).toEqual({ cols: 100, rows: 40 });
    vi.advanceTimersByTime(60);
    expect(resize).toHaveBeenLastCalledWith("b", 100, 40);
  });
});

describe("PtyHost clear", () => {
  it("forgets the history in the model and the sidecar ring, then sends Ctrl+L", async () => {
    const clear = vi.fn(async () => {});
    const write = vi.fn(async () => {});
    const client = {
      ...(fakeSidecar().client as object),
      snapshot: async () => "old history\r\n",
      clear,
      write,
    } as unknown as SidecarClient;
    const host = new PtyHost();
    host.connectToSidecar(client);
    await host.reattachSession("c", { cols: 80, rows: 24 }, callbacks);
    await new Promise((r) => setTimeout(r, 20));
    expect(host.getSnapshot("c")).toContain("old history");
    host.clear("c");
    expect(clear).toHaveBeenCalledWith("c");
    expect(write).toHaveBeenCalledWith("c", "\x0c");
    expect(host.getSnapshot("c")).not.toContain("old history");
  });
});

describe("PtyHost reattach", () => {
  it("rebuilds the model from the ring without replaying it as new output", async () => {
    const onData = vi.fn();
    const client = {
      ...(fakeSidecar().client as object),
      snapshot: async () => "old screen\r\n",
    } as unknown as SidecarClient;
    const host = new PtyHost();
    host.connectToSidecar(client);
    const snapshot = await host.reattachSession("r", { cols: 80, rows: 24 }, {
      onData,
      onExit: () => {},
    } as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(snapshot?.snapshot).toBe("old screen\r\n");
    expect(onData).not.toHaveBeenCalled();
    expect(host.getSnapshot("r")).toContain("old screen");
  });

  it("resolves only once the ring is parsed, so a pane's snapshot right after is not empty", async () => {
    const client = {
      ...(fakeSidecar().client as object),
      snapshot: async () => `${"history line\r\n".repeat(2000)}idle prompt> `,
    } as unknown as SidecarClient;
    const host = new PtyHost();
    host.connectToSidecar(client);
    await host.reattachSession("ready", { cols: 80, rows: 24 }, callbacks);
    expect(host.getLiveSnapshot("ready")).toContain("idle prompt>");
  });
});

describe("PtyHost reattach at the pane's size", () => {
  afterEach(() => vi.useRealTimers());

  function sidecarWithOutput(snapshot: () => Promise<string>) {
    let emit: (id: string, data: string) => void = () => {};
    const client = {
      ...(fakeSidecar().client as object),
      snapshot,
      onSessionData: (cb: typeof emit) => {
        emit = cb;
      },
    } as unknown as SidecarClient;
    return { client, output: (id: string, data: string) => emit(id, data) };
  }

  it("holds a resize that arrives mid-replay until the ring is parsed at its own grid", async () => {
    let release: (s: string) => void = () => {};
    const { client } = sidecarWithOutput(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    const host = new PtyHost();
    host.connectToSidecar(client);
    const done = host.reattachSession("m", { cols: 100, rows: 30 }, callbacks);
    host.resize("m", 140, 40);
    expect(host.getSize("m")).toEqual({ cols: 100, rows: 30 });
    release("history\r\n");
    await done;
    expect(host.getSize("m")).toEqual({ cols: 140, rows: 40 });
  });

  it("a TUI reflowed to the pane's size is ready once its repaint pauses", async () => {
    const { client, output } = sidecarWithOutput(async () => "frame\r\n");
    const host = new PtyHost();
    host.connectToSidecar(client);
    host.resize("t", 140, 40);
    const result = await host.reattachSession("t", { cols: 100, rows: 30 }, callbacks, {
      tui: true,
    });
    expect(result?.repainted).toBeInstanceOf(Promise);
    vi.useFakeTimers();
    let repainted = false;
    void result?.repainted?.then(() => {
      repainted = true;
    });
    output("t", "\x1b[2J redraw part 1");
    await vi.advanceTimersByTimeAsync(REPAINT_QUIET_MS - 20);
    output("t", "redraw part 2");
    await vi.advanceTimersByTimeAsync(REPAINT_QUIET_MS - 20);
    expect(repainted).toBe(false);
    await vi.advanceTimersByTimeAsync(40);
    expect(repainted).toBe(true);
  });

  it("a CLI that never repaints is shown at the cap", async () => {
    // Empty ring: nothing for xterm to parse under fake timers
    const { client } = sidecarWithOutput(async () => "");
    const host = new PtyHost();
    host.connectToSidecar(client);
    host.resize("q", 90, 20);
    vi.useFakeTimers();
    const result = await host.reattachSession("q", { cols: 100, rows: 30 }, callbacks, {
      tui: true,
    });
    let repainted = false;
    void result?.repainted?.then(() => {
      repainted = true;
    });
    await vi.advanceTimersByTimeAsync(REPAINT_CAP_MS - 1);
    expect(repainted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(repainted).toBe(true);
  });

  it("a shell, or a pane already at the stored grid, is ready without waiting", async () => {
    const { client } = sidecarWithOutput(async () => "$ ls\r\n");
    const host = new PtyHost();
    host.connectToSidecar(client);
    host.resize("sh", 140, 40);
    const shell = await host.reattachSession("sh", { cols: 100, rows: 30 }, callbacks);
    expect(shell?.repainted).toBeNull();
    host.resize("same", 100, 30);
    const same = await host.reattachSession("same", { cols: 100, rows: 30 }, callbacks, {
      tui: true,
    });
    expect(same?.repainted).toBeNull();
  });
});

describe("HeadlessEmulator writeParsed", () => {
  it("a disposed emulator never leaves the reattach waiting", async () => {
    const emulator = new HeadlessEmulator(80, 24);
    const parsed = emulator.writeParsed("x".repeat(10_000));
    emulator.dispose();
    await expect(parsed).resolves.toBeUndefined();
  });
});
