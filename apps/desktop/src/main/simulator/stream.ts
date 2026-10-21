import { type ChildProcess, spawn } from "node:child_process";
import { SIM_STREAM_SCALE, type SimStreamEvent } from "@exegol/shared";
import { logger } from "../lib/logger";
import { detectAxe } from "./axe";
import { MjpegParser } from "./mjpeg";

/** What a stream needs from its window: Electron's WebContents fits */
export interface FrameSink {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

/** At scale 1 AXe sends PNG, which the parser skips: keep it below */
export function streamArgs(scale: number): string[] {
  const clamped = Math.min(Math.max(scale, 0.1), 0.9);
  return ["--format", "mjpeg", "--fps", "15", "--quality", "70", "--scale", String(clamped)];
}

/** Frames past this rate wait and only the newest is sent */
const MIN_SEND_INTERVAL_MS = 50;
/** Hidden: the process is stopped (SIGSTOP) at once and killed after this */
const HIDDEN_KILL_MS = 10_000;
const KILL_GRACE_MS = 2_000;

interface Stream {
  key: string;
  paneId: string;
  udid: string;
  sink: FrameSink;
  child: ChildProcess | null;
  suspended: boolean;
  /** What the pane reports; the window being minimized or hidden also hides it */
  visible: boolean;
  hiddenTimer: ReturnType<typeof setTimeout> | null;
  sendTimer: ReturnType<typeof setTimeout> | null;
  latest: { jpeg: Buffer; at: number } | null;
  lastSentAt: number;
  live: boolean;
  launching: boolean;
}

const streams = new Map<string, Stream>();
const hiddenSinks = new Set<number>();
const keyOf = (sink: FrameSink, paneId: string) => `${sink.id}:${paneId}`;
const shown = (stream: Stream) => stream.visible && !hiddenSinks.has(stream.sink.id);
const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

function emit(stream: Stream, event: SimStreamEvent): void {
  if (!stream.sink.isDestroyed()) stream.sink.send("simulator:stream-state", event);
}

function sendLatest(stream: Stream): void {
  stream.sendTimer = null;
  if (!shown(stream) || !stream.latest) return;
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
  if (!shown(stream) || stream.sendTimer) return;
  const wait = Math.max(0, MIN_SEND_INTERVAL_MS - (Date.now() - stream.lastSentAt));
  stream.sendTimer = setTimeout(() => sendLatest(stream), wait);
}

function signalChild(stream: Stream, suspend: boolean): void {
  const child = stream.child;
  if (!child || !running(child) || stream.suspended === suspend) return;
  stream.suspended = suspend;
  child.kill(suspend ? "SIGSTOP" : "SIGCONT");
}

function killChild(stream: Stream): void {
  const child = stream.child;
  const wasSuspended = stream.suspended;
  stream.child = null;
  stream.live = false;
  stream.suspended = false;
  if (!child || !running(child)) return;
  child.kill("SIGTERM");
  // A stopped process only acts on SIGTERM once continued
  if (wasSuspended) child.kill("SIGCONT");
  setTimeout(() => {
    if (running(child)) child.kill("SIGKILL");
  }, KILL_GRACE_MS).unref();
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
  if (!shown(stream)) return;
  emit(stream, { paneId: stream.paneId, state: "starting" });
  const child = spawn(
    axe,
    ["stream-video", "--udid", stream.udid, ...streamArgs(SIM_STREAM_SCALE)],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  stream.child = child;
  const parser = new MjpegParser((jpeg) => onFrame(stream, jpeg));
  child.stdout?.on("data", (chunk: Buffer) => parser.push(chunk));
  child.stderr?.resume();
  const ended = (reason: string) => {
    if (stream.child !== child) return;
    stream.child = null;
    stream.live = false;
    stream.suspended = false;
    emit(stream, { paneId: stream.paneId, state: "ended", reason });
  };
  child.on("error", (err) => ended(err.message));
  child.on("exit", (code, signal) => ended(`AXe stopped (${code ?? signal})`));
}

/** Applies the pane's and the window's visibility to the process */
function sync(stream: Stream): void {
  if (shown(stream)) {
    if (stream.hiddenTimer) clearTimeout(stream.hiddenTimer);
    stream.hiddenTimer = null;
    if (!stream.child) {
      void launch(stream).catch((err) => logger.warn("[Simulator] stream start failed:", err));
      return;
    }
    signalChild(stream, false);
    if (stream.latest) sendLatest(stream);
    return;
  }
  signalChild(stream, true);
  if (stream.hiddenTimer) return;
  stream.hiddenTimer = setTimeout(() => {
    stream.hiddenTimer = null;
    killChild(stream);
    emit(stream, { paneId: stream.paneId, state: "paused" });
  }, HIDDEN_KILL_MS);
}

/** One AXe process per pane; a second call for the same pane retargets or shows it */
export function startStream(sink: FrameSink, paneId: string, udid: string): void {
  const key = keyOf(sink, paneId);
  const existing = streams.get(key);
  if (existing && existing.udid !== udid) stopStream(sink, paneId);
  else if (existing) {
    existing.visible = true;
    sync(existing);
    // A remounted pane starts at "starting": tell it where the stream is
    if (existing.child) {
      emit(existing, { paneId, state: existing.live ? "live" : "starting" });
    }
    return;
  }
  const stream: Stream = {
    key,
    paneId,
    udid,
    sink,
    child: null,
    suspended: false,
    visible: true,
    hiddenTimer: null,
    sendTimer: null,
    latest: null,
    lastSentAt: 0,
    live: false,
    launching: false,
  };
  streams.set(key, stream);
  sync(stream);
}

export function setStreamVisible(sink: FrameSink, paneId: string, visible: boolean): void {
  const stream = streams.get(keyOf(sink, paneId));
  if (!stream) return;
  stream.visible = visible;
  sync(stream);
}

/** The window was minimized or hidden (or came back) */
export function setSinkHidden(sinkId: number, hidden: boolean): void {
  if (hidden === hiddenSinks.has(sinkId)) return;
  if (hidden) hiddenSinks.add(sinkId);
  else hiddenSinks.delete(sinkId);
  for (const stream of streams.values()) if (stream.sink.id === sinkId) sync(stream);
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

/** The page reloaded, crashed or closed: its panes are gone */
export function stopSinkStreams(sinkId: number, forget = false): void {
  for (const stream of [...streams.values()]) {
    if (stream.sink.id === sinkId) stopStream(stream.sink, stream.paneId);
  }
  if (forget) hiddenSinks.delete(sinkId);
}

/** App quit: synchronous, every AXe process gets its signal */
export function stopAllStreams(): void {
  for (const stream of [...streams.values()]) stopStream(stream.sink, stream.paneId);
}
