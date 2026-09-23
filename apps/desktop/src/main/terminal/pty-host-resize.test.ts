import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/event-bus", () => ({ broadcast: vi.fn() }));

import { broadcast } from "../lib/event-bus";
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
