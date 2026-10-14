import { describe, expect, it, vi } from "vitest";
import { PtyHost } from "./pty-host";
import type { SidecarClient } from "./pty-sidecar-client";

const { holder } = vi.hoisted(() => ({ holder: { host: null as PtyHost | null } }));

vi.mock("../lib/event-bus", () => ({ broadcast: vi.fn() }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn() } }));
vi.mock("../db/client", () => ({
  getDb: () => ({ prepare: () => ({ run: () => {} }) }),
}));
vi.mock("../agents/manager", () => ({
  getAgentManager: () => ({
    resize: (id: string, cols: number, rows: number) => holder.host?.resize(id, cols, rows),
  }),
}));
vi.mock("./pty-host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pty-host")>()),
  getPtyHost: () => holder.host,
}));

import { requestPtyResize } from "./resize-request";

describe("requestPtyResize across a reattach", () => {
  it("a pane that asked for 76 rows mid-reattach and 66 once laid out ends at 66", async () => {
    const resize = vi.fn(async (_id: string, _cols: number, _rows: number) => {});
    let release: (data: string) => void = () => {};
    const client = {
      isConnected: () => true,
      snapshot: () =>
        new Promise<string>((r) => {
          release = r;
        }).then((data) => ({ data })),
      resize,
      onSessionData: () => {},
      onSessionExit: () => {},
      onSessionError: () => {},
      onShuttingDown: () => {},
      onClose: () => {},
    } as unknown as SidecarClient;
    const host = new PtyHost();
    holder.host = host;
    host.connectToSidecar(client);
    const callbacks = { onData: () => {}, onExit: () => {} } as never;
    // The stored grid is the real one (66): the first fit overshoots, the settled one is 66 again
    const done = host.reattachSession("p", { cols: 282, rows: 66 }, callbacks);
    requestPtyResize("p", 282, 76);
    requestPtyResize("p", 282, 66);
    release("");
    await done;
    expect(host.getSize("p")).toEqual({ cols: 282, rows: 66 });
    expect(resize).toHaveBeenLastCalledWith("p", 282, 66);

    // Same after the reattach: overshoot, then the settled size
    requestPtyResize("p", 282, 76);
    requestPtyResize("p", 282, 66);
    expect(resize).toHaveBeenLastCalledWith("p", 282, 66);
    expect(host.getSize("p")).toEqual({ cols: 282, rows: 66 });
  });
});
