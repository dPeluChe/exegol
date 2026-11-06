import type { AgentStatus, ScreenDialog } from "@exegol/shared";
import type Database from "libsql";
import { isAgentQuiet } from "../db/queries";
import { logger } from "../lib/logger";
import { getNotificationBus } from "../notifications/bus";
import { getPtyHost } from "../terminal/pty-host";
import { isAgentAwaitingApproval } from "./agent-message-queue";
import { lastAgentOutput } from "./agent-message-sweep";
import { broadcastAgentStatus } from "./spawn-env";
import { writeAgentStatus } from "./status-writes";

const CHECK_MS = 3_000;
const ANSWERED_STEP = "Working";
const ASKED_STEP = "Waiting for your answer";

type Row = { id: string; project_id: string; cli_type: string; status: AgentStatus };

interface Watched {
  /** Output stamp of the last read: nothing new on screen, nothing to read */
  readAt?: number;
  /** Seen once, not alerted: a dialog counts when it holds still for two reads */
  seen?: string;
  /** The dialog already alerted, and whether this watch moved the status for it */
  alerted?: string;
  movedStatus?: boolean;
}

export type QuestionStep = "none" | "alert" | "resolved";

/** One read of a session's screen; pure so the two-read rule and the release stay testable */
export function questionStep(state: Watched, dialog: ScreenDialog | null): QuestionStep {
  if (!dialog?.picked) {
    state.seen = undefined;
    if (!state.alerted) return "none";
    state.alerted = undefined;
    return "resolved";
  }
  if (dialog.fingerprint === state.alerted) return "none";
  if (dialog.fingerprint !== state.seen) {
    state.seen = dialog.fingerprint;
    return "none";
  }
  state.seen = undefined;
  state.alerted = dialog.fingerprint;
  return "alert";
}

const watched = new Map<string, Watched>();

function liveSessions(db: Database.Database): Row[] {
  return db
    .prepare(
      `SELECT id, project_id, cli_type, status FROM agents
       WHERE archived_at IS NULL AND suspended_at IS NULL AND cli_type != 'shell'
         AND status IN ('running', 'idle', 'waiting_input')`,
    )
    .all() as Row[];
}

function push(row: Row, status: AgentStatus, step: string, needsAttention: boolean): void {
  broadcastAgentStatus({
    agentId: row.id,
    projectId: row.project_id,
    status,
    currentStep: step,
    cliType: row.cli_type,
    timestamp: Date.now(),
    needsAttention,
  });
}

function alert(db: Database.Database, row: Row, state: Watched, dialog: ScreenDialog): void {
  logger.info(`[QuestionWatch] ${row.id} ${row.cli_type} question on screen`);
  state.movedStatus = row.status !== "waiting_input";
  if (state.movedStatus) writeAgentStatus(db, row.id, "waiting_input", ASKED_STEP);
  getNotificationBus().emit({
    type: "agent:attention",
    title: "Agent needs your attention",
    body: dialog.question ?? "",
    agentId: row.id,
    projectId: row.project_id,
    at: Date.now(),
  });
  push(row, "waiting_input", ASKED_STEP, true);
}

/** CLIs ask in their own screen, most with no hook for it: the picker itself is the signal.
 *  A permission prompt with a hook already alerted, so it stays out */
export function checkQuestions(db: Database.Database): void {
  const host = getPtyHost();
  const live = liveSessions(db).filter((r) => host.isAlive(r.id));
  const liveIds = new Set(live.map((r) => r.id));
  for (const id of watched.keys()) if (!liveIds.has(id)) watched.delete(id);
  for (const row of live) {
    const state = watched.get(row.id) ?? {};
    watched.set(row.id, state);
    const output = lastAgentOutput(row.id);
    if (output === state.readAt && !state.seen) continue;
    state.readAt = output;
    if (isAgentAwaitingApproval(row.id) || isAgentQuiet(db, row.id)) continue;
    const dialog = host.screenDialog(row.id);
    const step = questionStep(state, dialog);
    if (step === "alert" && dialog) alert(db, row, state, dialog);
    if (step === "resolved" && state.movedStatus && row.status === "waiting_input") {
      state.movedStatus = false;
      writeAgentStatus(db, row.id, "running", ANSWERED_STEP);
      push(row, "running", ANSWERED_STEP, false);
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startQuestionWatch(db: Database.Database): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      checkQuestions(db);
    } catch (err) {
      logger.warn("[QuestionWatch] check failed:", err);
    }
  }, CHECK_MS);
  timer.unref?.();
}
