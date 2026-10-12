import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/event-bus", () => ({ broadcast: vi.fn() }));

import { broadcast } from "../lib/event-bus";
import { PtyHost } from "./pty-host";
import type { SidecarClient } from "./pty-sidecar-client";
import type { SessionInfo, SessionSnapshotResult } from "./pty-sidecar-protocol";

type DataCb = (id: string, data: string, seq?: number) => void;
type ExitCb = (id: string, exitCode: number, signal?: number) => void;

function fakeClient(
  snapshot: (id: string) => Promise<SessionSnapshotResult>,
  listSessionsInfo?: () => Promise<SessionInfo[]>,
) {
  let emit: DataCb = () => {};
  let exit: ExitCb = () => {};
  const client = {
    isConnected: () => true,
    snapshot: vi.fn(snapshot),
    listSessionsInfo: listSessionsInfo ?? (async () => Promise.reject(new Error("old sidecar"))),
    disconnect: vi.fn(),
    onSessionData: (cb: DataCb) => {
      emit = cb;
    },
    onSessionExit: (cb: ExitCb) => {
      exit = cb;
    },
    onSessionError: () => {},
  } as unknown as SidecarClient & { snapshot: ReturnType<typeof vi.fn> };
  return {
    client,
    emit: (id: string, data: string, seq?: number) => emit(id, data, seq),
    exit: (id: string, code: number) => exit(id, code),
  };
}

const callbacks = { onData: () => {}, onExit: () => {}, onError: () => {} } as never;
const ring = (data: string, seq?: number) => async () => ({ data, seq });
const settle = () => new Promise((r) => setTimeout(r, 20));
const repaintOf = (id: string) =>
  vi.mocked(broadcast).mock.calls.find((c) => c[0] === "terminal:data" && c[1] === id);

beforeEach(() => vi.mocked(broadcast).mockClear());

describe("PtyHost Retry swap", () => {
  it("rebuilds the model from the ring, keeps output after it, and repaints views", async () => {
    const old = fakeClient(ring(""));
    const host = new PtyHost();
    host.connectToSidecar(old.client);
    await host.reattachSession("a", { cols: 80, rows: 24 }, callbacks);
    // The seam doubled a chunk in the old model
    old.emit("a", "one\r\n");
    old.emit("a", "one\r\n");

    let reply: (v: SessionSnapshotResult) => void = () => {};
    const fresh = fakeClient(() => new Promise((r) => (reply = r)));
    const swapped = host.swapSidecarClient(fresh.client);
    expect(old.client.disconnect).toHaveBeenCalled();
    await vi.waitFor(() => expect(fresh.client.snapshot).toHaveBeenCalled());
    reply({ data: "one\r\n" });
    await new Promise((r) => setTimeout(r, 0));
    fresh.emit("a", "two\r\n");
    await swapped;
    await settle();

    const model = host.getSnapshot("a") ?? "";
    expect(model.match(/one/g)).toHaveLength(1);
    expect(model).toContain("two");
    const painted = String(repaintOf("a")?.[2]);
    expect(painted.startsWith("\x1bc")).toBe(true);
    expect(painted.indexOf("one")).toBeLessThan(painted.indexOf("two"));
  });

  it("leaves the model alone when the ring cannot be read", async () => {
    const old = fakeClient(ring(""));
    const host = new PtyHost();
    host.connectToSidecar(old.client);
    await host.reattachSession("b", { cols: 80, rows: 24 }, callbacks);
    old.emit("b", "kept\r\n");
    await host.swapSidecarClient(fakeClient(async () => Promise.reject(new Error("x"))).client);
    await settle();
    expect(host.getSnapshot("b")).toContain("kept");
  });

  it("by seq: a session that got every frame is left alone, one that lost frames is rebuilt", async () => {
    const old = fakeClient(ring("", 0));
    const host = new PtyHost();
    host.connectToSidecar(old.client);
    await host.reattachSession("x", { cols: 80, rows: 24 }, callbacks);
    await host.reattachSession("y", { cols: 80, rows: 24 }, callbacks);
    old.emit("x", "x1\r\n", 1);
    old.emit("y", "y1\r\n", 1);
    // y2 was sent to the old socket but never read
    const fresh = fakeClient(ring("y1\r\ny2\r\n", 2), async () => [
      { id: "x", alive: true, exitCode: null, signal: null, seq: 1 },
      { id: "y", alive: true, exitCode: null, signal: null, seq: 2 },
    ]);
    await host.swapSidecarClient(fresh.client);
    await settle();
    expect(fresh.client.snapshot).toHaveBeenCalledTimes(1);
    expect(fresh.client.snapshot).toHaveBeenCalledWith("y");
    expect(repaintOf("x")).toBeUndefined();
    expect(host.getSnapshot("y")).toContain("y2");
    // A frame both sockets carried is applied once
    fresh.emit("x", "x1\r\n", 1);
    fresh.emit("x", "x2\r\n", 2);
    await settle();
    const model = host.getSnapshot("x") ?? "";
    expect(model.match(/x1/g)).toHaveLength(1);
    expect(model).toContain("x2");
  });
});

describe("PtyHost reattach by seq", () => {
  it("drops frames that arrive during the ring read when the ring already holds them", async () => {
    let reply: (v: SessionSnapshotResult) => void = () => {};
    const c = fakeClient(() => new Promise((r) => (reply = r)));
    const host = new PtyHost();
    host.connectToSidecar(c.client);
    const done = host.reattachSession("r", { cols: 80, rows: 24 }, callbacks, {
      snapshotMaxBytes: 1024,
    });
    expect(c.client.snapshot).toHaveBeenCalledWith("r", 1024);
    c.emit("r", "early\r\n", 5);
    reply({ data: "early\r\n", seq: 5 });
    await done;
    c.emit("r", "late\r\n", 6);
    await settle();
    const model = host.getSnapshot("r") ?? "";
    expect(model.match(/early/g)).toHaveLength(1);
    expect(model).toContain("late");
  });
});

describe("PtyHost reattach ordering", () => {
  it("an exit during the ring read runs after the held frames, which follow the seeded scrollback", async () => {
    const order: string[] = [];
    let reply: (v: SessionSnapshotResult) => void = () => {};
    const c = fakeClient(() => new Promise((r) => (reply = r)));
    const host = new PtyHost();
    host.connectToSidecar(c.client);
    const cbs = {
      onData: (d: string) => order.push(`data ${d}`),
      onExit: (code: number) => order.push(`exit ${code}`),
      onError: () => {},
    };
    const done = host.reattachSession("e", { cols: 80, rows: 24 }, cbs, {
      onSnapshot: (ring) => order.push(`seed ${ring}`),
    });
    c.emit("e", "last words", 8);
    c.exit("e", 0);
    expect(order).toEqual([]);
    reply({ data: "history", seq: 7 });
    await done;
    expect(order).toEqual(["seed history", "data last words", "exit 0"]);
    expect(host.isAlive("e")).toBe(false);
  });

  it("a Retry swap during the ring read reads it again from the new client", async () => {
    let fail: (e: Error) => void = () => {};
    const old = fakeClient(() => new Promise((_, reject) => (fail = reject)));
    const host = new PtyHost();
    host.connectToSidecar(old.client);
    const done = host.reattachSession("w", { cols: 80, rows: 24 }, callbacks);
    const fresh = fakeClient(ring("from the new socket\r\n", 3), async () => []);
    await host.swapSidecarClient(fresh.client);
    // The swap closed the old socket under the read
    fail(new Error("Sidecar connection closed"));
    const result = await done;
    expect(result?.snapshot).toContain("from the new socket");
    expect(fresh.client.snapshot).toHaveBeenCalledWith("w", undefined);
  });
});
