import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pidState = vi.hoisted(() => ({ pid: null as number | null, alive: false }));
vi.mock("./pty-sidecar-discovery", () => ({
  readPidFile: () => (pidState.pid ? { pid: pidState.pid } : null),
  isProcessAlive: () => pidState.alive,
}));

import { SidecarLossHandler } from "./pty-host-loss";
import type { Session } from "./pty-session-types";
import { BURST_WINDOW_MS, exitKind, GONE_WITHOUT_NOTICE, SidecarLossTracker } from "./sidecar-loss";

function harness() {
  const sessions = new Map<string, Session>();
  const events: string[] = [];
  const add = (id: string) => {
    const s = { id, mode: "sidecar", alive: true } as Session;
    sessions.set(id, s);
    return s;
  };
  const handler = new SidecarLossHandler({
    sessions,
    finishNormal: (s, code) => {
      sessions.delete(s.id);
      events.push(`normal ${s.id} ${code}`);
    },
    finishLost: (s, reason, persist) => {
      s.alive = false;
      sessions.delete(s.id);
      events.push(`lost ${s.id} ${reason}${persist ? "" : " (relaunch)"}`);
    },
  });
  const losses: string[] = [];
  handler.onSidecarLost((r) => losses.push(r));
  return { handler, add, events, losses };
}

beforeEach(() => {
  vi.useFakeTimers();
  pidState.pid = 42;
  pidState.alive = true;
});
afterEach(() => vi.useRealTimers());

describe("exitKind", () => {
  it("noticed is lost; close behind another exit waits; alone is the CLI's", () => {
    expect(exitKind(true, 0)).toBe("lost");
    expect(exitKind(false, 2)).toBe("hold");
    expect(exitKind(false, 0)).toBe("normal");
  });

  it("the burst window forgets old exits", () => {
    let now = 0;
    const t = new SidecarLossTracker(() => now);
    expect(t.onExit("a")).toBe("normal");
    now = 500;
    expect(t.onExit("b")).toBe("hold");
    now = 500 + BURST_WINDOW_MS + 1;
    expect(t.onExit("c")).toBe("normal");
  });
});

describe("SidecarLossHandler", () => {
  it("a notice turns the sidecar's exits into losses, then reports the batch once", async () => {
    const { handler, add, events, losses } = harness();
    const a = add("a");
    const b = add("b");
    handler.notice("SIGTERM", ["a", "b"]);
    handler.exit(a, 1);
    handler.exit(b, 1);
    expect(events).toEqual(["lost a SIGTERM", "lost b SIGTERM"]);
    await vi.advanceTimersByTimeAsync(400);
    expect(losses).toEqual(["SIGTERM"]);
  });

  it("socket loss with the process gone: held exits and sessions still open are lost", async () => {
    const { handler, add, events } = harness();
    const a = add("a");
    const b = add("b");
    add("c");
    handler.exit(a, 1);
    handler.exit(b, 1);
    pidState.pid = null;
    handler.socketClosed();
    expect(events).toEqual([
      "normal a 1",
      `lost b ${GONE_WITHOUT_NOTICE}`,
      `lost c ${GONE_WITHOUT_NOTICE}`,
    ]);
  });

  it("a socket that closes while the sidecar still runs loses nothing", () => {
    const { handler, add, events } = harness();
    add("a");
    handler.socketClosed();
    expect(events).toEqual([]);
  });

  it("a single natural exit stays the CLI's; a held one is the CLI's after the window", async () => {
    const { handler, add, events, losses } = harness();
    handler.exit(add("a"), 0);
    expect(events).toEqual(["normal a 0"]);
    handler.exit(add("b"), 2);
    expect(events).toEqual(["normal a 0"]);
    await vi.advanceTimersByTimeAsync(BURST_WINDOW_MS);
    expect(events).toEqual(["normal a 0", "normal b 2"]);
    expect(losses).toEqual([]);
  });

  it("Restart terminals: losses are not persisted and nothing is offered before the relaunch", async () => {
    const { handler, add, events, losses } = harness();
    handler.expectRelaunch();
    const a = add("a");
    handler.notice("shutdown requested", ["a"]);
    handler.exit(a, 1);
    await vi.advanceTimersByTimeAsync(400);
    expect(events).toEqual(["lost a shutdown requested (relaunch)"]);
    expect(losses).toEqual([]);
  });
});
