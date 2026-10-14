import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/event-bus", () => ({ broadcast: vi.fn() }));

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

describe("PtyHost parsedLiveSnapshot", () => {
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

  it("is null for an unknown session", async () => {
    expect(await new PtyHost().parsedLiveSnapshot("none")).toBeNull();
  });
});
