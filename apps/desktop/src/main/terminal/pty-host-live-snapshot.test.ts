import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/event-bus", () => ({ broadcast: vi.fn() }));

import type { HeadlessEmulator } from "./headless-emulator";
import { PtyHost } from "./pty-host";
import type { SidecarClient } from "./pty-sidecar-client";

function sidecarWithData() {
  let emit: (id: string, data: string, seq?: number) => void = () => {};
  const client = {
    isConnected: () => true,
    snapshot: async () => ({ data: "", seq: 0 }),
    resize: async () => {},
    onSessionData: (cb: typeof emit) => {
      emit = cb;
    },
    onSessionExit: () => {},
    onSessionError: () => {},
    onShuttingDown: () => {},
    onClose: () => {},
  } as unknown as SidecarClient;
  return { client, emit: (id: string, data: string, seq: number) => emit(id, data, seq) };
}

async function hostWithSession() {
  const host = new PtyHost();
  const { client, emit } = sidecarWithData();
  host.connectToSidecar(client);
  await host.reattachSession("s", { cols: 80, rows: 24 }, {
    onData: () => {},
    onExit: () => {},
  } as never);
  return { host, emit };
}

function emulatorOf(host: PtyHost, id: string): HeadlessEmulator | undefined {
  return (
    host as unknown as { sessions: Map<string, { emulator: HeadlessEmulator }> }
  ).sessions.get(id)?.emulator;
}

describe("PtyHost parsedLiveSnapshot", () => {
  afterEach(() => vi.useRealTimers());

  it("holds every frame applied before it, and names the last one by seq", async () => {
    const host = new PtyHost();
    const { client, emit } = sidecarWithData();
    host.connectToSidecar(client);
    const seen: Array<number | undefined> = [];
    await host.reattachSession("s", { cols: 80, rows: 24 }, {
      onData: (_d: string, seq?: number) => seen.push(seq),
      onExit: () => {},
    } as never);
    // Queued in xterm, not parsed yet: a plain serialize here missed them
    emit("s", "first ", 1);
    emit("s", "second", 2);
    const snap = await host.parsedLiveSnapshot("s");
    expect(snap?.data).toContain("first second");
    expect(snap?.seq).toBe(2);
    expect(snap).toMatchObject({ cols: 80, rows: 24 });
    expect(seen).toEqual([1, 2]);
  });

  it("leaves out output that arrived after it was asked for, and its seq", async () => {
    const { host, emit } = await hostWithSession();
    emit("s", "before ", 1);
    const pending = host.parsedLiveSnapshot("s");
    emit("s", "after", 2);
    const snap = await pending;
    expect(snap?.data).toContain("before");
    expect(snap?.data).not.toContain("after");
    expect(snap?.seq).toBe(1);
    expect(snap?.alt).toBe(false);
  });

  it("past the deadline it serializes anyway, without a seq", async () => {
    const { host, emit } = await hostWithSession();
    emit("s", "x", 1);
    const emulator = emulatorOf(host, "s");
    const terminal = (emulator as unknown as { terminal: { write: (d: string) => void } }).terminal;
    vi.useFakeTimers();
    terminal.write = () => {}; // a parse that never reports back
    const pending = host.parsedLiveSnapshot("s");
    await vi.advanceTimersByTimeAsync(1_500);
    const snap = await pending;
    expect(snap).not.toBeNull();
    expect(snap?.seq).toBeUndefined();
  });

  it("is null for an unknown session", async () => {
    expect(await new PtyHost().parsedLiveSnapshot("none")).toBeNull();
  });
});
