import { type ChildProcess, spawn } from "node:child_process";
import type { SimStreamEvent } from "@exegol/shared";
import { logger } from "../lib/logger";
import { detectAxe } from "./axe";
import { MjpegParser } from "./mjpeg";

/** What a stream needs from its window: Electron's WebContents fits */
export interface FrameSink {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  once(event: "destroyed", listener: () => void): unknown;
}

export const STREAM_ARGS = [
  "--format",
  "mjpeg",
  "--fps",
  "15",
  "--quality",
  "70",
  "--scale",
  "0.5",
];
/** Frames past this rate wait and only the newest is sent */
const MIN_SEND_INTERVAL_MS = 50;
/** A pane hidden this long lets its AXe process go; showing it again starts one */
export const HIDDEN_GRACE_MS = 30_000;

interface Stream {
  key: string;
  paneId: string;
  udid: string;
  sink: FrameSink;
  child: ChildProcess | null;
  visible: boolean;
  hiddenTimer: ReturnType<typeof setTimeout> | null;
  sendTimer: ReturnType<typeof setTimeout> | null;
  latest: { jpeg: Buffer; at: number } | null;
  lastSentAt: number;
  live: boolean;
  launching: boolean;
}

const streams = new Map<string, Stream>();
const watchedSinks = new Set<number>();
const keyOf = (sink: FrameSink, paneId: string) => `${sink.id}:${paneId}`;

function emit(stream: Stream, event: SimStreamEvent): void {
  if (!stream.sink.isDestroyed()) stream.sink.send("simulator:stream-state", event);
}

function sendLatest(stream: Stream): void {
  stream.sendTimer = null;
  if (!stream.visible || !stream.latest) return;
  if (stream.sink.isDestroyed()) {
    stopStream(stream.sink, stream.paneId);
    return;
  }
  const { jpeg, at } = stream.latest;
  stream.latest = null;
  stream.lastSentAt = Date.now();
  stream.sink.send("simulator:frame", stream.paneId, jpeg, at);
}

function onFrame(stream: Stream, jpeg: Buffer): void {
  stream.latest = { jpeg, at: Date.now() };
  if (!stream.live) {
    stream.live = true;
    emit(stream, { paneId: stream.paneId, state: "live" });
  }
  if (!stream.visible || stream.sendTimer) return;
  const wait = Math.max(0, MIN_SEND_INTERVAL_MS - (Date.now() - stream.lastSentAt));
  stream.sendTimer = setTimeout(() => sendLatest(stream), wait);
}

function killChild(stream: Stream): void {
  const child = stream.child;
  stream.child = null;
  stream.live = false;
  if (child && child.exitCode === null) child.kill("SIGTERM");
}

async function launch(stream: Stream): Promise<void> {
  if (stream.launching || stream.child) return;
  stream.launching = true;
  const axe = await detectAxe().finally(() => {
    stream.launching = false;
  });
  if (streams.get(stream.key) !== stream || stream.child) return;
  if (!axe) {
    emit(stream, { paneId: stream.paneId, state: "ended", reason: "AXe is not installed" });
    return;
  }
  emit(stream, { paneId: stream.paneId, state: "starting" });
  const child = spawn(axe, ["stream-video", "--udid", stream.udid, ...STREAM_ARGS], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  stream.child = child;
  const parser = new MjpegParser((jpeg) => onFrame(stream, jpeg));
  child.stdout?.on("data", (chunk: Buffer) => parser.push(chunk));
  child.stderr?.resume();
  const ended = (reason: string) => {
    if (stream.child !== child) return;
    stream.child = null;
    stream.live = false;
    emit(stream, { paneId: stream.paneId, state: "ended", reason });
  };
  child.on("error", (err) => ended(err.message));
  child.on("exit", (code, signal) => ended(`AXe stopped (${code ?? signal})`));
}

/** One AXe process per pane; a second call for the same pane retargets or shows it */
export function startStream(sink: FrameSink, paneId: string, udid: string): void {
  const key = keyOf(sink, paneId);
  const existing = streams.get(key);
  if (existing && existing.udid !== udid) stopStream(sink, paneId);
  else if (existing) {
    setStreamVisible(sink, paneId, true);
    return;
  }
  const stream: Stream = {
    key,
    paneId,
    udid,
    sink,
    child: null,
    visible: true,
    hiddenTimer: null,
    sendTimer: null,
    latest: null,
    lastSentAt: 0,
    live: false,
    launching: false,
  };
  streams.set(key, stream);
  if (!watchedSinks.has(sink.id)) {
    watchedSinks.add(sink.id);
    const id = sink.id;
    sink.once("destroyed", () => {
      watchedSinks.delete(id);
      for (const s of [...streams.values()]) if (s.sink.id === id) stopStream(s.sink, s.paneId);
    });
  }
  void launch(stream).catch((err) => logger.warn("[Simulator] stream start failed:", err));
}

/** Hidden: frames stop crossing IPC at once, the process goes after HIDDEN_GRACE_MS */
export function setStreamVisible(sink: FrameSink, paneId: string, visible: boolean): void {
  const stream = streams.get(keyOf(sink, paneId));
  if (!stream || stream.visible === visible) {
    if (stream && visible && !stream.child) void launch(stream);
    return;
  }
  stream.visible = visible;
  if (stream.hiddenTimer) clearTimeout(stream.hiddenTimer);
  stream.hiddenTimer = null;
  if (visible) {
    if (!stream.child) void launch(stream);
    else if (stream.latest) sendLatest(stream);
    return;
  }
  stream.hiddenTimer = setTimeout(() => {
    stream.hiddenTimer = null;
    killChild(stream);
    emit(stream, { paneId, state: "paused" });
  }, HIDDEN_GRACE_MS);
}

export function stopStream(sink: FrameSink, paneId: string): void {
  const key = keyOf(sink, paneId);
  const stream = streams.get(key);
  if (!stream) return;
  streams.delete(key);
  if (stream.hiddenTimer) clearTimeout(stream.hiddenTimer);
  if (stream.sendTimer) clearTimeout(stream.sendTimer);
  killChild(stream);
}

/** App quit: synchronous, every AXe process gets its signal */
export function stopAllStreams(): void {
  for (const stream of [...streams.values()]) stopStream(stream.sink, stream.paneId);
}

export function activeStreamCount(): number {
  return [...streams.values()].filter((s) => s.child).length;
}
