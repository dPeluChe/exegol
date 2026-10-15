import type { ChildProcess } from "node:child_process";
import type { HeadlessEmulator } from "./headless-emulator";
import type { FrameDecoder } from "./pty-ipc";
import type { HeldFrame } from "./sidecar-resync";

export type ShellReadyState = "pending" | "ready" | "timed_out" | "unsupported";

export interface SessionCallbacks {
  /** `seq`: the session's output seq after this chunk (views drop what their snapshot holds) */
  onData: (data: string, seq?: number) => void;
  onExit: (exitCode: number, signal?: number) => void;
  onError: (message: string) => void;
  /** Gone with the sidecar, not the CLI's own exit: no finalize, no scoring, no cleanup */
  onLost?: (reason: string, persist: boolean) => void;
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
  /** Set while Retry rebuilds the model from the ring: output that came after the ring's copy */
  resyncTail?: string[];
  /** Seq of the last sidecar output frame applied (sidecar-resync.ts); legacy sessions count
   *  their own chunks */
  lastSeq?: number;
  /** A frame arrived past lastSeq + 1: some were lost (a Retry swap rebuilds it) */
  seqGap?: boolean;
  /** Frames that arrive while a reattach reads the ring, applied after it by seq */
  heldFrames?: HeldFrame[];
  /** An exit that arrived while frames were held: it runs after them */
  pendingExit?: { exitCode: number; signal?: number };
}

export const MAX_CONCURRENT_SPAWNS = 3;
export const SCROLLBACK_THROTTLE_MS = 5_000;
export const SUBPROCESS_READY_TIMEOUT_MS = 10_000;
export const SHELL_READY_TIMEOUT_MS = 15_000;
