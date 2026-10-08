// Pure decisions for clean-build.ts: which entries go, given names, versions and ages.

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface Entry {
  name: string;
  mtimeMs: number;
}

interface Version {
  core: [number, number, number];
  pre: string | null;
}

const VERSION_DIR = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(name: string): Version | null {
  const m = VERSION_DIR.exec(name);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    const d = (a.core[i] ?? 0) - (b.core[i] ?? 0);
    if (d !== 0) return d;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  const pa = a.pre.split(".");
  const pb = b.pre.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) return nx - ny;
    if (nx !== null || ny !== null) return nx !== null ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

const isLocal = (v: Version) => /(^|[.-])local($|[.-])/.test(v.pre ?? "");

/**
 * dist/<version> folders: keep the newest `keep` and the current version; of the
 * `-local` test builds keep only the newest by date. Names that are not a version are never listed
 */
export function planDist(entries: Entry[], current: string, keep: number): string[] {
  const versioned = entries.flatMap((e) => {
    const v = parseVersion(e.name);
    return v ? [{ ...e, v }] : [];
  });
  const released = versioned
    .filter((e) => !isLocal(e.v))
    .sort((a, b) => compareVersions(b.v, a.v))
    .slice(keep);
  const locals = versioned
    .filter((e) => isLocal(e.v))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(1);
  return [...released, ...locals].map((e) => e.name).filter((name) => name !== current);
}

const TURBO_FILE = /^([0-9a-f]{16})(-manifest\.json|-meta\.json|\.tar\.zst)$/;

/** .turbo/cache: a hash's files go together, once the newest of them is older than the cutoff */
export function planTurbo(entries: Entry[], cutoff: number): string[] {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const hash = TURBO_FILE.exec(e.name)?.[1];
    if (!hash) continue;
    groups.set(hash, [...(groups.get(hash) ?? []), e]);
  }
  return [...groups.values()]
    .filter((files) => Math.max(...files.map((f) => f.mtimeMs)) < cutoff)
    .flatMap((files) => files.map((f) => f.name));
}

const INCREMENTAL_DIR = /^[A-Za-z0-9_]+-[a-z0-9]+$/;

/** target/<profile>/incremental/<crate>-<hash>: cargo rebuilds a missing one */
export function planIncremental(entries: Entry[], cutoff: number): string[] {
  return entries
    .filter((e) => INCREMENTAL_DIR.test(e.name) && e.mtimeMs < cutoff)
    .map((e) => e.name);
}

// mkdtemp prefixes of the test suites (not the app's own temp files, e.g. exegol-skill-, exegol-bug-)
const TEST_TMP_PREFIXES = [
  "brief-test",
  "codex",
  "dl",
  "diag",
  "digest-test",
  "droid",
  "evidence-test",
  "folder",
  "gemini",
  "git-status-test",
  "global-skills",
  "goose",
  "history",
  "housekeeping",
  "icon",
  "icons",
  "ide",
  "junk",
  "link",
  "links",
  "mcp-test",
  "model",
  "models",
  "oc",
  "outside",
  "prune",
  "real",
  "run",
  "run-refresh",
  "scrollback",
  "skill-test",
  "storage",
  "tar",
  "tokens",
  "turn",
  "walk",
  "write",
];
const TEST_TMP_DIR = new RegExp(`^exegol-(?:${TEST_TMP_PREFIXES.join("|")})-[A-Za-z0-9]{6}$`);

export function planTestTmp(entries: Entry[], cutoff: number): string[] {
  return entries.filter((e) => TEST_TMP_DIR.test(e.name) && e.mtimeMs < cutoff).map((e) => e.name);
}

export { parseWorktreeList } from "../src/main/lib/worktree-safety";

/** From `gh pr list --head <branch> --state all --json state`; null = gh missing or offline */
export function prVerdict(states: string[] | null): "unknown" | "open" | "none" | "done" {
  if (states === null) return "unknown";
  if (states.includes("OPEN")) return "open";
  return states.length === 0 ? "none" : "done";
}

export const AGENT_WORKTREE_DIR = /^agent-[A-Za-z0-9]+$/;

/** True when an `lsof -d cwd -Fn` line names `dir` or a folder inside it */
export function cwdInside(lsofOutput: string, dir: string): boolean {
  return lsofOutput
    .split("\n")
    .filter((l) => l.startsWith("n"))
    .some((l) => l.slice(1) === dir || l.slice(1).startsWith(`${dir}/`));
}

/**
 * An agent worktree is a removal candidate only when registered, unlocked and its branch's PR
 * merged or closed; an unregistered folder is reported, never removed
 */
export function agentWorktreeAction(
  registered: { branch: string | null; locked: boolean } | undefined,
  pr: ReturnType<typeof prVerdict> | null,
): { action: "candidate" | "report" | "keep"; note: string } {
  if (!registered) return { action: "report", note: "not a registered worktree, report only" };
  if (registered.locked) return { action: "keep", note: "locked" };
  if (!registered.branch) return { action: "keep", note: "detached HEAD, PR unknown" };
  if (pr === "done")
    return { action: "candidate", note: `PR of ${registered.branch} merged or closed` };
  const notes = {
    unknown: "PR state unknown (gh missing or offline)",
    open: "PR open",
    none: "no PR",
  };
  return { action: "keep", note: `${registered.branch}: ${notes[pr ?? "unknown"]}` };
}

const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/** What the user could run to put a kept worktree's work on its branch (the script never does) */
export function saveCommands(dir: string, branch: string | null, reason: string): string | null {
  if (!branch) return null;
  const g = `git -C ${shellQuote(dir)}`;
  const push = `${g} push -u origin ${shellQuote(branch)}`;
  if (reason === "unpushed commits") return push;
  if (reason !== "uncommitted changes") return null;
  return `${g} add -A && ${g} commit -m 'wip: save work' && ${push}`;
}
