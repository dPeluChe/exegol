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
  return a.pre < b.pre ? -1 : 1;
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
