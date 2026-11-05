// No electron or logger imports: pure rules, unit tested.
import { JANITOR_DIRS } from "./worktree-safety";

export const JANITOR_IDLE_MS = 24 * 60 * 60 * 1000;
/** The daily runs land a little under 24 h apart; a mark that old counts as a full day */
const MARK_SLACK_MS = 60 * 60 * 1000;

/** HEAD and its last reflog entry, and since when the janitor has seen them unchanged */
export interface JanitorMark {
  fingerprint: string;
  since: number;
}

/** What git says, cheap to read: checked before any file is listed */
export interface JanitorGitLook {
  fingerprint: string;
  /** No tracked change, no untracked file (ignored ones aside) */
  clean: boolean;
  /** Rebase, merge, submodules, not its own checkout or a git failure */
  blocked: string | null;
}

/** What the files say: newest mtime of tracked and untracked files and of the sheddable dirs'
 *  top entries, and those dirs (relative, from a `--directory` listing) */
export interface JanitorFileLook {
  newestMtimeMs: number;
  sheddable: string[];
}

type KeepReason =
  | "in use"
  | "blocked"
  | "uncommitted changes"
  | "first look"
  | "head moved"
  | "not idle long enough"
  | "files changed recently"
  | "nothing to free";

export type JanitorVerdict = { shed: true; dirs: string[] } | { shed: false; reason: KeepReason };

interface GateInput {
  busy: boolean;
  git: JanitorGitLook;
  prev: JanitorMark | undefined;
  now: number;
  idleMs?: number;
}

/** The mark to keep for next time: an unchanged HEAD and reflog keep their first sighting */
export function nextMark(prev: JanitorMark | undefined, fingerprint: string, now: number) {
  return prev && prev.fingerprint === fingerprint ? prev : { fingerprint, since: now };
}

/** The rules git alone decides; null = go on and look at the files */
export function janitorGate(input: GateInput): KeepReason | null {
  const { busy, git, prev, now, idleMs = JANITOR_IDLE_MS } = input;
  if (busy) return "in use";
  if (git.blocked) return "blocked";
  if (!git.clean) return "uncommitted changes";
  if (!prev) return "first look";
  if (prev.fingerprint !== git.fingerprint) return "head moved";
  if (now - prev.since < idleMs - MARK_SLACK_MS) return "not idle long enough";
  return null;
}

/**
 * Sheds only when every rule holds: nothing live uses it, git can read it and nothing is under
 * way, it is clean, HEAD and reflog have not moved for the idle window and no file changed in it
 */
export function janitorVerdict(input: GateInput & { files: JanitorFileLook }): JanitorVerdict {
  const gate = janitorGate(input);
  if (gate) return { shed: false, reason: gate };
  const { files, now, idleMs = JANITOR_IDLE_MS } = input;
  if (now - files.newestMtimeMs < idleMs) return { shed: false, reason: "files changed recently" };
  if (files.sheddable.length === 0) return { shed: false, reason: "nothing to free" };
  return { shed: true, dirs: files.sheddable };
}

/** Entries of `git ls-files --others --ignored --exclude-standard --directory`: the collapsed
 *  ignored directories whose own name is on the list, never `..` or an absolute path */
export function sheddableDirs(listing: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of listing) {
    if (!entry.endsWith("/")) continue;
    const rel = entry.slice(0, -1);
    const parts = rel.split("/");
    if (!rel || rel.startsWith("/") || parts.some((p) => p === ".." || p === "." || !p)) continue;
    if (parts.includes(".git")) continue;
    const name = parts[parts.length - 1] as string;
    if (!JANITOR_DIRS.has(name)) continue;
    // One inside another listed dir goes with it
    if (parts.slice(0, -1).some((p) => JANITOR_DIRS.has(p))) continue;
    out.push(rel);
  }
  return out;
}
