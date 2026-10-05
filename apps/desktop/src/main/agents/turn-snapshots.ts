import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import type { LatestTurn, TurnChanges, TurnFileChange, UndoTurnResult } from "@exegol/shared";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { captureTree, git } from "../pipeline/git-evidence";
import { commitStepSnapshot, prepareStepSnapshot } from "../pipeline/oplog-snapshots";

/** T200.5: turns kept per agent; older ones stay in the project's Oplog timeline */
export const MAX_TURNS_PER_AGENT = 20;

interface OpenTurn {
  turnIndex: number;
  startedAt: number;
  cwd: string;
  startTree: Promise<string | null>;
}

interface TurnRecord {
  public: TurnChanges;
  cwd: string;
  provider: string;
  startTree: string;
  endTree: string;
}

interface AgentTurns {
  open: OpenTurn | null;
  turns: TurnRecord[];
  counter: number;
  warnedNotGit: boolean;
}

const agents = new Map<string, AgentTurns>();

function entryFor(agentId: string): AgentTurns {
  let entry = agents.get(agentId);
  if (!entry) {
    entry = { open: null, turns: [], counter: 0, warnedNotGit: false };
    agents.set(agentId, entry);
  }
  return entry;
}

/** `git diff --numstat -z` records; binary files report "-" counts */
export function parseNumstat(out: string): TurnFileChange[] {
  const files: TurnFileChange[] = [];
  for (const record of out.split("\0")) {
    const [add, del, ...rest] = record.split("\t");
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

async function snapshotTree(entry: AgentTurns, agentId: string, cwd: string) {
  try {
    return await captureTree(cwd);
  } catch (err) {
    // A folder outside git fails every turn: say so once
    if (!entry.warnedNotGit) {
      entry.warnedNotGit = true;
      logger.info(`[Turns] No turn snapshots for ${agentId}: ${(err as Error).message}`);
    }
    return null;
  }
}

/** UserPromptSubmit. A turn interrupted with Esc never gets Stop, so an open turn keeps
 *  its first start: the next Stop covers both prompts instead of losing the first one's edits */
export function startTurn(agentId: string, cwd: string): void {
  const entry = entryFor(agentId);
  if (entry.open) return;
  entry.counter += 1;
  entry.open = {
    turnIndex: entry.counter,
    startedAt: Date.now(),
    cwd,
    startTree: snapshotTree(entry, agentId, cwd),
  };
  broadcast("agent:turn-changes", { agentId });
}

/** Stop: diff the turn, commit its start onto the oplog chain when it changed files */
export async function endTurn(agentId: string, projectId: string, provider: string) {
  const entry = agents.get(agentId);
  const open = entry?.open;
  if (!entry || !open) return;
  entry.open = null;
  try {
    const [startTree, endTree] = await Promise.all([
      open.startTree,
      snapshotTree(entry, agentId, open.cwd),
    ]);
    if (!startTree || !endTree || startTree === endTree) return;
    const files = parseNumstat(
      await git(open.cwd, ["diff", "--numstat", "-z", "--no-renames", startTree, endTree]),
    );
    // The agent exited while this ran: nothing left to show it on
    if (files.length === 0 || agents.get(agentId) !== entry) return;
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
      public: {
        agentId,
        projectId,
        turnIndex: open.turnIndex,
        startedAt: open.startedAt,
        endedAt: Date.now(),
        snapshotSha,
        files,
      },
      cwd: open.cwd,
      provider,
      startTree,
      endTree,
    };
    entry.turns = [record, ...entry.turns].slice(0, MAX_TURNS_PER_AGENT);
  } catch (err) {
    logger.warn(`[Turns] Turn ${open.turnIndex} of ${agentId} not recorded:`, err);
  } finally {
    broadcast("agent:turn-changes", { agentId });
  }
}

export function forgetTurns(agentId: string): void {
  agents.delete(agentId);
}

export function latestTurn(agentId: string): LatestTurn {
  const entry = agents.get(agentId);
  return { turn: entry?.turns[0]?.public ?? null, inTurn: !!entry?.open };
}

function findTurn(agentId: string, turnIndex: number): TurnRecord {
  const turn = agents.get(agentId)?.turns.find((t) => t.public.turnIndex === turnIndex);
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

/** path → blob sha in `tree`; a path missing from the map is absent there */
async function treeBlobs(root: string, tree: string, paths: string[]) {
  const out = await git(root, ["--literal-pathspecs", "ls-tree", "-r", "-z", tree, "--", ...paths]);
  const blobs = new Map<string, string>();
  for (const record of out.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [, type, sha] = record.slice(0, tab).split(" ");
    blobs.set(record.slice(tab + 1), type === "blob" ? (sha ?? "") : `${type}:${sha}`);
  }
  return blobs;
}

/** path → blob sha of the working-tree file (git's filters applied, as `git add` would),
 *  null when absent; a directory or other non-file maps to "" so it never matches */
async function workingBlobs(root: string, paths: string[]) {
  const current = new Map<string, string | null>();
  const files: string[] = [];
  for (const path of paths) {
    const stat = await lstat(join(root, path)).catch(() => null);
    if (!stat) current.set(path, null);
    else if (stat.isFile()) files.push(path);
    else current.set(path, "");
  }
  if (files.length > 0) {
    const shas = (await git(root, ["hash-object", "--", ...files])).trim().split("\n");
    for (const [i, path] of files.entries()) current.set(path, shas[i] ?? "");
  }
  return current;
}

/** Puts back the newest turn's files that are still as the turn left them; a file edited
 *  since is left alone and reported. No branch commit: a PreRestore snapshot on the oplog
 *  chain makes the undo itself undoable */
export async function undoLatestTurn(agentId: string, turnIndex: number): Promise<UndoTurnResult> {
  const entry = agents.get(agentId);
  if (entry?.open) throw new Error("The agent is in a turn; undo once it stops");
  const turn = entry?.turns[0];
  if (!entry || !turn || turn.public.turnIndex !== turnIndex) {
    throw new Error("Only the newest turn can be undone");
  }
  const projectId = turn.public.projectId;
  const root = (await git(turn.cwd, ["rev-parse", "--show-toplevel"])).trim();
  const paths = turn.public.files.map((f) => f.path);
  const [start, end, current] = await Promise.all([
    treeBlobs(root, turn.startTree, paths),
    treeBlobs(root, turn.endTree, paths),
    workingBlobs(root, paths),
  ]);
  const restored: string[] = [];
  const skipped: string[] = [];
  for (const path of paths) {
    (current.get(path) === (end.get(path) ?? null) ? restored : skipped).push(path);
  }
  if (restored.length === 0) return { projectId, restored, skipped };

  const safetyTree = prepareStepSnapshot(turn.cwd);
  const safetySha = commitStepSnapshot(
    turn.cwd,
    safetyTree,
    agentId,
    turn.provider,
    turnIndex,
    `Before undoing turn ${turnIndex}`,
    "PreRestore",
  );
  if (!safetySha) throw new Error("Could not take a safety snapshot; nothing was undone");

  const toRestore = restored.filter((p) => start.has(p));
  if (toRestore.length > 0) {
    await git(root, [
      "--literal-pathspecs",
      "restore",
      `--source=${turn.startTree}`,
      "--worktree",
      "--",
      ...toRestore,
    ]);
  }
  for (const path of restored.filter((p) => !start.has(p))) {
    await rm(join(root, path), { force: true });
  }
  entry.turns = entry.turns.slice(1);
  logger.info(`[Turns] Undid turn ${turnIndex} of ${agentId}`, {
    restored: restored.length,
    skipped: skipped.length,
    safety: safetySha.slice(0, 8),
  });
  broadcast("agent:turn-changes", { agentId });
  return { projectId, restored, skipped };
}
