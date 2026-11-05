import type { AgentSignalType } from "@exegol/shared";
import { logger } from "../lib/logger";
import type { TermReport } from "./osc-status-scanner";

/** The answer to `OSC 7501 ; ?`: echoing the query body is what pi and Claude Code accept */
export const PROGRAM_STATUS_REPLY = "\x1b]7501;?\x1b\\";

type Phase = "none" | "working" | "blocked" | "done" | "idle";

interface TermStatusState {
  phase: Phase;
  /** Once a program speaks OSC 7501, its progress reports (which go on meanwhile) are not its status */
  reportsStatus: boolean;
}

export const INITIAL_TERM_STATUS: TermStatusState = { phase: "none", reportsStatus: false };

function phaseOf(report: TermReport, state: TermStatusState): Phase | null {
  if (report.kind === "status") {
    switch (report.state) {
      case "working":
        return "working";
      case "blocked":
        return "blocked";
      case "done":
      case "error":
        return "done";
      default:
        return "idle";
    }
  }
  if (report.kind !== "progress" || state.reportsStatus) return null;
  if (report.state !== "0") return "working";
  return state.phase === "working" || state.phase === "blocked" ? "done" : null;
}

/** What a phase change means in the hook signal model. An error ends the turn, not the session
 *  (the CLI goes on), and an idle with no turn running before it says nothing new. */
function signalFor(prev: Phase, next: Phase): AgentSignalType | null {
  const inTurn = prev === "working" || prev === "blocked";
  switch (next) {
    case "working":
      return prev === "blocked" ? "working" : "turn_started";
    case "blocked":
      return "attention";
    default:
      return inTurn ? "finished" : null;
  }
}

/** Pure: fold a chunk's reports into the session's state and the signals they mean */
export function termStatusSignals(
  state: TermStatusState,
  reports: readonly TermReport[],
): { state: TermStatusState; signals: AgentSignalType[] } {
  let next = state;
  const signals: AgentSignalType[] = [];
  for (const report of reports) {
    if (report.kind === "status" && !next.reportsStatus) next = { ...next, reportsStatus: true };
    const phase = phaseOf(report, next);
    if (!phase) continue;
    if (phase === next.phase) continue;
    const signal = signalFor(next.phase, phase);
    if (signal) signals.push(signal);
    next = { ...next, phase };
  }
  return { state: next, signals };
}

const sessions = new Map<string, TermStatusState>();
/** Agents a hook (OSC 777 or file event) has spoken for: hooks win, these reports go unused */
const hooked = new Set<string>();
const answered = new Set<string>();

export function noteHookSignal(agentId: string): void {
  hooked.add(agentId);
}

/** The signals a chunk's reports mean for this agent, and whether it asked for the 7501 reply */
export function takeTermStatus(
  agentId: string,
  cliType: string,
  reports: readonly TermReport[],
): { signals: AgentSignalType[]; reply: boolean } {
  const reply = reports.some((r) => r.kind === "query");
  if (reply && !answered.has(agentId)) {
    answered.add(agentId);
    logger.info(`[TermStatus] ${agentId} (${cliType}) asked for OSC 7501: answering`);
  }
  const prev = sessions.get(agentId) ?? INITIAL_TERM_STATUS;
  const { state, signals } = termStatusSignals(prev, reports);
  if (!sessions.has(agentId) && state !== prev) {
    logger.info(
      `[TermStatus] ${agentId} (${cliType}) reports status by ${state.reportsStatus ? "OSC 7501" : "OSC 9;4"}`,
    );
  }
  if (state !== prev) sessions.set(agentId, state);
  return { signals: hooked.has(agentId) ? [] : signals, reply };
}

export function forgetTermStatus(agentId: string): void {
  sessions.delete(agentId);
  hooked.delete(agentId);
  answered.delete(agentId);
}
