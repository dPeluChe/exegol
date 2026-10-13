import { describe, expect, it, vi } from "vitest";
import type { SidecarClient } from "./pty-sidecar-client";
import { OLD_SIDECAR_EXIT_WAIT_MS, successorSidecar } from "./sidecar-reconnect";

const client = (pid: number) => ({ pid, disconnect: vi.fn() }) as unknown as SidecarClient;

describe("reconnect after a sidecar stopped under the app", () => {
  it("waits for the stopping sidecar to exit before discovery runs", async () => {
    const order: string[] = [];
    let alive = true;
    const result = await successorSidecar({
      oldPid: 100,
      waitForExit: async (pid, ms) => {
        order.push(`wait ${pid} ${ms}`);
        alive = false;
      },
      isProcessAlive: () => alive,
      ensureSidecar: async () => {
        order.push(alive ? "discover (old alive)" : "discover");
        return client(200);
      },
    });
    expect(order).toEqual([`wait 100 ${OLD_SIDECAR_EXIT_WAIT_MS}`, "discover"]);
    expect(result?.pid).toBe(200);
  });

  it("never reuses the retiring sidecar, even if discovery hands it back", async () => {
    const old = client(100);
    const result = await successorSidecar({
      oldPid: 100,
      waitForExit: async () => {},
      isProcessAlive: () => true,
      ensureSidecar: async () => old,
    });
    expect(result).toBeNull();
    expect(old.disconnect).toHaveBeenCalled();
  });

  it("with no known old pid, takes what discovery finds", async () => {
    const result = await successorSidecar({
      oldPid: null,
      waitForExit: vi.fn(),
      isProcessAlive: () => true,
      ensureSidecar: async () => client(300),
    });
    expect(result?.pid).toBe(300);
  });
});
