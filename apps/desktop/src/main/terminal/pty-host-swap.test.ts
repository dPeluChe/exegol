import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/event-bus", () => ({ broadcast: vi.fn() }));

import { broadcast } from "../lib/event-bus";
import { PtyHost } from "./pty-host";
import type { SidecarClient } from "./pty-sidecar-client";

type DataCb = (id: string, data: string) => void;

function fakeClient(snapshot: (id: string) => Promise<string | null>) {
  let emit: DataCb = () => {};
  const client = {
    isConnected: () => true,
    snapshot,
    disconnect: vi.fn(),
    onSessionData: (cb: DataCb) => {
      emit = cb;
    },
    onSessionExit: () => {},
    onSessionError: () => {},
  } as unknown as SidecarClient;
  return { client, emit: (id: string, data: string) => emit(id, data) };
}

const callbacks = { onData: () => {}, onExit: () => {}, onError: () => {} } as never;

describe("PtyHost Retry swap", () => {
  it("rebuilds the model from the ring, keeps output after it, and repaints views", async () => {
    const old = fakeClient(async () => "");
    const host = new PtyHost();
    host.connectToSidecar(old.client);
    await host.reattachSession("a", { cols: 80, rows: 24 }, callbacks);
    // The seam doubled a chunk in the old model
    old.emit("a", "one\r\n");
    old.emit("a", "one\r\n");

    let reply: (v: string) => void = () => {};
    const fresh = fakeClient(() => new Promise((r) => (reply = r)));
    const swapped = host.swapSidecarClient(fresh.client);
    expect(old.client.disconnect).toHaveBeenCalled();
    await Promise.resolve();
    reply("one\r\n");
    await new Promise((r) => setTimeout(r, 0));
    fresh.emit("a", "two\r\n");
    await swapped;
    await new Promise((r) => setTimeout(r, 20));

    const model = host.getSnapshot("a") ?? "";
    expect(model.match(/one/g)).toHaveLength(1);
    expect(model).toContain("two");
    const repaint = vi
      .mocked(broadcast)
      .mock.calls.find((c) => c[0] === "terminal:data" && c[1] === "a");
    const painted = String(repaint?.[2]);
    expect(painted.startsWith("\x1bc")).toBe(true);
    expect(painted.indexOf("one")).toBeLessThan(painted.indexOf("two"));
  });

  it("leaves the model alone when the ring cannot be read", async () => {
    const old = fakeClient(async () => "");
    const host = new PtyHost();
    host.connectToSidecar(old.client);
    await host.reattachSession("b", { cols: 80, rows: 24 }, callbacks);
    old.emit("b", "kept\r\n");
    await host.swapSidecarClient(fakeClient(async () => Promise.reject(new Error("x"))).client);
    await new Promise((r) => setTimeout(r, 20));
    expect(host.getSnapshot("b")).toContain("kept");
  });
});
