export type Worktree = {
  id: string;
  projectId: string;
  agentId: string | null;
  path: string;
  branchName: string;
  autoCleanup: boolean;
  diskUsageBytes: number;
  createdAt: number;
};

/** T176: a worktree as the fleet view needs it — the row plus who is still in
 *  it and what the disk says. */
export type FleetWorktree = Worktree & {
  projectName: string;
  liveAgents: number;
  exists: boolean;
  dirty: boolean;
};

/** Gitignore-syntax patterns of local files copied into a new agent worktree; `!` excludes */
export const DEFAULT_WORKTREE_COPY: readonly string[] = [
  ".env",
  ".env.*",
  "!.env.example",
  "!.env.sample",
  "!.env.template",
];

const MAX_WORKTREE_COPY_PATTERNS = 40;

/** Textarea or array input to a clean list: one pattern per line, `#` comments and blanks dropped */
export function parseWorktreeCopy(input: string | readonly string[]): string[] {
  const lines = typeof input === "string" ? input.split("\n") : input;
  const out: string[] = [];
  for (const raw of lines) {
    const p = raw.trim();
    if (!p || p.startsWith("#") || p.length > 200 || /[\0\r]/.test(p) || out.includes(p)) continue;
    out.push(p);
  }
  return out.slice(0, MAX_WORKTREE_COPY_PATTERNS);
}

/** A project's patterns: null (never set) is the default list, [] copies nothing */
export function worktreeCopyPatterns(saved: readonly string[] | null | undefined): string[] {
  return saved ? [...saved] : [...DEFAULT_WORKTREE_COPY];
}
