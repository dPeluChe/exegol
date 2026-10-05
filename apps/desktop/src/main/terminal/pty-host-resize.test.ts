import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/event-bus", () => ({ broadcast: vi.fn() }));

import { broadcast } from "../lib/event-bus";
import { HeadlessEmulator } from "./headless-emulator";
import { PtyHost } from "./pty-host";
import type { SidecarClient } from "./pty-sidecar-client";

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
    expect(snapshot).toBe("old screen\r\n");
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

describe("HeadlessEmulator writeParsed", () => {
  it("a disposed emulator never leaves the reattach waiting", async () => {
    const emulator = new HeadlessEmulator(80, 24);
    const parsed = emulator.writeParsed("x".repeat(10_000));
    emulator.dispose();
    await expect(parsed).resolves.toBeUndefined();
  });
});
