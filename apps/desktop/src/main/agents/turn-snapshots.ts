import type { TurnChanges, TurnFileChange } from "@exegol/shared";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { captureTree, git } from "../pipeline/git-evidence";
import { commitStepSnapshot } from "../pipeline/oplog-snapshots";
import { coreRust } from "./spawn-env";

/** T200.5: turns kept per agent; older ones stay in the project's Oplog timeline */
export const MAX_TURNS_PER_AGENT = 20;

interface OpenTurn {
  turnIndex: number;
  startedAt: number;
  cwd: string;
  startTree: Promise<string | null>;
}

type TurnRecord = TurnChanges & { cwd: string; startTree: string; endTree: string };

const openTurns = new Map<string, OpenTurn>();
const turns = new Map<string, TurnRecord[]>();
const turnCounters = new Map<string, number>();
const notGit = new Set<string>();

/** `git diff --numstat` lines; binary files report "-" counts */
export function parseNumstat(out: string): TurnFileChange[] {
  const files: TurnFileChange[] = [];
  for (const line of out.split("\n")) {
    const [add, del, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (!path || add === undefined || del === undefined) continue;
    files.push({
      path,
      additions: add === "-" ? null : Number(add),
      deletions: del === "-" ? null : Number(del),
    });
  }
  return files;
}

/** Newest first, capped */
export function pushTurn<T>(list: readonly T[], turn: T, max = MAX_TURNS_PER_AGENT): T[] {
  return [turn, ...list].slice(0, max);
}

function toPublic({ cwd: _c, startTree: _s, endTree: _e, ...turn }: TurnRecord): TurnChanges {
  return turn;
}

async function snapshotTree(agentId: string, cwd: string): Promise<string | null> {
  try {
    return await captureTree(cwd);
  } catch (err) {
    // A folder outside git fails every turn: say so once
    if (!notGit.has(agentId)) {
      notGit.add(agentId);
      logger.info(`[Turns] No turn snapshots for ${agentId}: ${(err as Error).message}`);
    }
    return null;
  }
}

/** UserPromptSubmit. A turn interrupted with Esc never gets Stop, so an open turn keeps
 *  its first start: the next Stop covers both prompts instead of losing the first one's edits */
export function startTurn(agentId: string, cwd: string): void {
  if (openTurns.has(agentId)) return;
  const turnIndex = (turnCounters.get(agentId) ?? 0) + 1;
  turnCounters.set(agentId, turnIndex);
  openTurns.set(agentId, {
    turnIndex,
    startedAt: Date.now(),
    cwd,
    startTree: snapshotTree(agentId, cwd),
  });
}

/** Stop: diff the turn, commit its start onto the oplog chain when it changed files */
export async function endTurn(agentId: string, projectId: string, provider: string) {
  const open = openTurns.get(agentId);
  if (!open) return;
  openTurns.delete(agentId);
  try {
    const [startTree, endTree] = await Promise.all([
      open.startTree,
      snapshotTree(agentId, open.cwd),
    ]);
    if (!startTree || !endTree || startTree === endTree) return;
    const files = parseNumstat(
      await git(open.cwd, ["diff", "--numstat", "--no-renames", startTree, endTree]),
    );
    // The agent exited while this ran: nothing left to show it on
    if (files.length === 0 || !turnCounters.has(agentId)) return;
    const snapshotSha = commitStepSnapshot(
      open.cwd,
      startTree,
      agentId,
      provider,
      open.turnIndex,
      `Before turn ${open.turnIndex} (${files.length} files changed)`,
      "AgentTurn",
    );
    if (!snapshotSha) return;
    const record: TurnRecord = {
      agentId,
      projectId,
      turnIndex: open.turnIndex,
      startedAt: open.startedAt,
      endedAt: Date.now(),
      snapshotSha,
      files,
      cwd: open.cwd,
      startTree,
      endTree,
    };
    turns.set(agentId, pushTurn(turns.get(agentId) ?? [], record));
    broadcast("agent:turn-changes", { agentId });
  } catch (err) {
    logger.warn(`[Turns] Turn ${open.turnIndex} of ${agentId} not recorded:`, err);
  }
}

export function forgetTurns(agentId: string): void {
  openTurns.delete(agentId);
  turns.delete(agentId);
  turnCounters.delete(agentId);
  notGit.delete(agentId);
}

/** The newest turn that changed files */
export function latestTurn(agentId: string): TurnChanges | null {
  const turn = turns.get(agentId)?.[0];
  return turn ? toPublic(turn) : null;
}

function findTurn(agentId: string, turnIndex: number): TurnRecord {
  const turn = turns.get(agentId)?.find((t) => t.turnIndex === turnIndex);
  if (!turn) throw new Error("That turn is no longer recorded");
  return turn;
}

export async function turnDiff(agentId: string, turnIndex: number): Promise<string> {
  const turn = findTurn(agentId, turnIndex);
  return git(turn.cwd, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    turn.startTree,
    turn.endTree,
  ]);
}

/** Restore the folder to before the newest turn, through the oplog restore (PreRestore
 *  safety snapshot, refuses another worktree's snapshot) */
export function undoLatestTurn(agentId: string, turnIndex: number): string {
  if (openTurns.has(agentId)) throw new Error("The agent is in a turn; undo once it stops");
  const list = turns.get(agentId) ?? [];
  const turn = list[0];
  if (!turn || turn.turnIndex !== turnIndex) throw new Error("Only the newest turn can be undone");
  if (!coreRust) throw new Error("Rust native module not available");
  const newSha = coreRust.restoreOplogSnapshot(turn.cwd, turn.snapshotSha);
  turns.set(agentId, list.slice(1));
  logger.info(`[Turns] Undid turn ${turnIndex} of ${agentId}`, { newCommit: newSha.slice(0, 8) });
  broadcast("agent:turn-changes", { agentId });
  return newSha;
}
