import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new EventEmitter();
  stderr = { resume: () => {} };
  signals: string[] = [];
  kill(signal: string) {
    this.signals.push(signal);
    return true;
  }
}

const children: FakeChild[] = [];
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  }),
}));
vi.mock("./axe", () => ({ detectAxe: vi.fn(async () => "/opt/homebrew/bin/axe") }));
vi.mock("../lib/logger", () => ({ logger: { warn: vi.fn() } }));

const { setSinkHidden, setStreamVisible, startStream, stopAllStreams, streamArgs } = await import(
  "./stream"
);

const JPEG = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
const part = (b: Buffer) =>
  Buffer.concat([Buffer.from(`--mjpegstream\r\nContent-Length: ${b.length}\r\n\r\n`), b]);

let nextId = 1;
function sink() {
  const sent: { channel: string; args: unknown[] }[] = [];
  return {
    id: nextId++,
    sent,
    isDestroyed: () => false,
    send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }),
    states: () =>
      sent
        .filter((m) => m.channel === "simulator:stream-state")
        .map((m) => (m.args[0] as { state: string }).state),
  };
}
const UDID = "7CE18B87-35AB-4E2B-A352-DD075A8219C4";

async function started() {
  const s = sink();
  startStream(s, "p1", UDID);
  await vi.waitFor(() => expect(children).toHaveLength(1));
  return { s, child: children[0] as FakeChild };
}

describe("simulator stream", () => {
  beforeEach(() => {
    children.length = 0;
  });
  afterEach(() => {
    stopAllStreams();
    vi.useRealTimers();
  });

  it("never asks AXe for scale 1 (it would send PNG)", () => {
    expect(streamArgs(1)).toContain("0.9");
    expect(streamArgs(0.5)).toContain("0.5");
  });

  it("tells a remounted pane the stream is already live", async () => {
    const { s, child } = await started();
    child.stdout.emit("data", part(JPEG));
    startStream(s, "p1", UDID);
    expect(s.states().at(-1)).toBe("live");
    expect(children).toHaveLength(1);
  });

  it("stops the process when hidden, continues it when shown, kills it after 10 s", async () => {
    const { s, child } = await started();
    vi.useFakeTimers();
    setStreamVisible(s, "p1", false);
    expect(child.signals).toEqual(["SIGSTOP"]);
    setStreamVisible(s, "p1", true);
    expect(child.signals).toEqual(["SIGSTOP", "SIGCONT"]);
    setStreamVisible(s, "p1", false);
    vi.advanceTimersByTime(10_000);
    expect(child.signals).toEqual(["SIGSTOP", "SIGCONT", "SIGSTOP", "SIGTERM", "SIGCONT"]);
    expect(s.states().at(-1)).toBe("paused");
    vi.advanceTimersByTime(2_000);
    expect(child.signals.at(-1)).toBe("SIGKILL");
  });

  it("a minimized window hides its panes", async () => {
    const { s, child } = await started();
    setSinkHidden(s.id, true);
    expect(child.signals).toEqual(["SIGSTOP"]);
    setSinkHidden(s.id, false);
    expect(child.signals).toEqual(["SIGSTOP", "SIGCONT"]);
  });

  it("does not SIGKILL a process that exited on SIGTERM", async () => {
    const { child } = await started();
    vi.useFakeTimers();
    stopAllStreams();
    child.exitCode = 0;
    vi.advanceTimersByTime(5_000);
    expect(child.signals).toEqual(["SIGTERM"]);
  });
});
