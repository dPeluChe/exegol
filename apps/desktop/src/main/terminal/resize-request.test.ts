import { beforeEach, describe, expect, it, vi } from "vitest";

const resize = vi.fn();
const info = vi.fn();
let host: { requestedSize: ReturnType<typeof vi.fn> };

vi.mock("../lib/event-bus", () => ({ broadcast: vi.fn() }));
vi.mock("../lib/logger", () => ({ logger: { info: (...a: unknown[]) => info(...a) } }));
vi.mock("../db/client", () => ({
  getDb: () => ({ prepare: () => ({ run: () => {} }) }),
}));
vi.mock("../agents/manager", () => ({ getAgentManager: () => ({ resize }) }));
vi.mock("./pty-host", () => ({ getPtyHost: () => host }));

import { requestPtyResize } from "./resize-request";

describe("requestPtyResize", () => {
  beforeEach(() => {
    resize.mockClear();
    info.mockClear();
  });

  it("drops a grid the PTY already has", () => {
    host = {
      requestedSize: vi.fn(() => ({ size: { cols: 120, rows: 40 }, held: false })),
    };
    requestPtyResize("same", 120, 40);
    expect(resize).not.toHaveBeenCalled();
  });

  it("sends the pane's grid when a card's size is held for the reattach, even if the model matches", () => {
    // The model (stale stored grid) is 120x40 = the pane; the card asked for 80x24 meanwhile
    host = {
      requestedSize: vi.fn(() => ({ size: { cols: 80, rows: 24 }, held: true })),
    };
    requestPtyResize("held", 120, 40);
    expect(resize).toHaveBeenCalledWith("held", 120, 40);
    expect(info).toHaveBeenCalledWith("[Resize] held 80x24 -> 120x40 (held for reattach)");
  });

  it("logs live changes at most once per 10 s per session", () => {
    host = {
      requestedSize: vi.fn(() => ({ size: { cols: 100, rows: 30 }, held: false })),
    };
    requestPtyResize("live", 90, 30);
    requestPtyResize("live", 91, 30);
    expect(resize).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledTimes(1);
  });
});
