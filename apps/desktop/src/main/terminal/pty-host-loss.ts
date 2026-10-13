// PtyHost's side of a sidecar that stopped under the running app: the sessions it took are lost
// (crashed, resumable), never finalized as the CLIs' own exits.
import { logger } from "../lib/logger";
import type { Session } from "./pty-session-types";
import { isProcessAlive, readPidFile } from "./pty-sidecar-discovery";
import { BURST_WINDOW_MS, GONE_WITHOUT_NOTICE, SidecarLossTracker } from "./sidecar-loss";

/** What the host gives the handler */
export interface LossHost {
  sessions: Map<string, Session>;
  /** The CLI's own exit: finalize as usual */
  finishNormal(s: Session, exitCode: number, signal?: number): void;
  /** Gone with the sidecar; `persist` false while the app relaunches (startup recovery has it) */
  finishLost(s: Session, reason: string, persist: boolean): void;
}

/** Once a batch of losses settles: reconnect and offer them for resume */
const BATCH_MS = 300;

export class SidecarLossHandler {
  private readonly tracker = new SidecarLossTracker();
  private readonly held = new Map<
    string,
    { s: Session; exitCode: number; signal?: number; timer: ReturnType<typeof setTimeout> }
  >();
  private relaunching = false;
  private batch: { reason: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private lostHandler: ((reason: string) => void) | null = null;

  constructor(private readonly host: LossHost) {}

  /** Called once the losses of one stop are handled (not while the app relaunches) */
  onSidecarLost(fn: (reason: string) => void): void {
    this.lostHandler = fn;
  }

  /** Restart terminals: the app relaunches, startup recovery takes the sessions */
  expectRelaunch(): void {
    this.relaunching = true;
  }

  notice(reason: string, ids: string[]): void {
    logger.warn(`[Sidecar] stopped with ${ids.length} live session(s): ${reason}`);
    this.tracker.notice(reason, ids);
    for (const id of ids) this.releaseHeld(id, reason);
  }

  exit(s: Session, exitCode: number, signal?: number): void {
    const kind = this.tracker.onExit(s.id);
    if (kind === "lost") {
      this.lose(s, this.tracker.reasonFor(s.id) ?? GONE_WITHOUT_NOTICE);
    } else if (kind === "hold") {
      const timer = setTimeout(() => {
        this.held.delete(s.id);
        this.host.finishNormal(s, exitCode, signal);
      }, BURST_WINDOW_MS);
      this.held.set(s.id, { s, exitCode, signal, timer });
    } else {
      this.host.finishNormal(s, exitCode, signal);
    }
  }

  /** The socket closed by itself: if the sidecar process is gone, every session left is lost */
  socketClosed(): void {
    const pid = readPidFile()?.pid;
    if (pid && isProcessAlive(pid)) return;
    const left = [...this.host.sessions.values()].filter((s) => s.mode === "sidecar" && s.alive);
    if (left.length > 0 || this.held.size > 0) {
      logger.warn(
        `[Sidecar] stopped with ${left.length + this.held.size} live session(s): ${GONE_WITHOUT_NOTICE}`,
      );
    }
    for (const id of [...this.held.keys()]) this.releaseHeld(id, GONE_WITHOUT_NOTICE);
    for (const s of left) this.lose(s, this.tracker.reasonFor(s.id) ?? GONE_WITHOUT_NOTICE);
  }

  private releaseHeld(id: string, reason: string): void {
    const h = this.held.get(id);
    if (!h) return;
    clearTimeout(h.timer);
    this.held.delete(id);
    this.lose(h.s, reason);
  }

  private lose(s: Session, reason: string): void {
    this.tracker.forget(s.id);
    if (!s.alive && !this.host.sessions.has(s.id)) return;
    this.host.finishLost(s, reason, !this.relaunching);
    if (this.relaunching) return;
    if (this.batch) clearTimeout(this.batch.timer);
    const timer = setTimeout(() => {
      this.batch = null;
      this.lostHandler?.(reason);
    }, BATCH_MS);
    this.batch = { reason, timer };
  }
}
