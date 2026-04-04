import type { ChildProcess } from "node:child_process";
import type { HeadlessEmulator } from "./headless-emulator";
import type { FrameDecoder } from "./pty-ipc";

export type ShellReadyState = "pending" | "ready" | "timed_out" | "unsupported";

export interface SessionCallbacks {
  onData: (data: string) => void;
  onExit: (exitCode: number, signal?: number) => void;
  onError: (message: string) => void;
}

export type SessionMode = "legacy" | "sidecar";

export interface Session {
  id: string;
  mode: SessionMode;
  child: ChildProcess | null;
  decoder: FrameDecoder | null;
  emulator: HeadlessEmulator;
  pid: number | null;
  alive: boolean;
  callbacks: SessionCallbacks;
  scrollbackPath: string | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  shellReadyState: ShellReadyState;
  preReadyStdinQueue: string[];
  markerMatchPos: number;
  markerHeldBytes: string;
  shellReadyTimeout: ReturnType<typeof setTimeout> | null;
}

export const MAX_CONCURRENT_SPAWNS = 3;
export const SCROLLBACK_THROTTLE_MS = 5_000;
export const SUBPROCESS_READY_TIMEOUT_MS = 10_000;
export const SHELL_READY_TIMEOUT_MS = 15_000;
