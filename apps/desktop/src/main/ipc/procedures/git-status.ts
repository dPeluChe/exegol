import { execFileAsync } from "../../integrations/github/gh";

export interface GitFileStatus {
  /** One letter: M A D R C T, "?" untracked, "U" conflict */
  status: string;
  staged: boolean;
  path: string;
  /** Source path of a rename or copy */
  origPath?: string;
}

const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** `git status --porcelain=v1 -z`: a file staged and changed again (MM) is one entry per side */
export function parseGitStatus(raw: string): GitFileStatus[] {
  const tokens = raw.split("\0");
  const files: GitFileStatus[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (token.length < 4) continue;
    const x = token[0] ?? " ";
    const y = token[1] ?? " ";
    const path = token.slice(3);
    const origPath = "RC".includes(x) || "RC".includes(y) ? tokens[++i] : undefined;
    if (x === "!") continue;
    if (x === "?") {
      files.push({ status: "?", staged: false, path });
      continue;
    }
    if (UNMERGED.has(x + y)) {
      files.push({ status: "U", staged: false, path });
      continue;
    }
    if (x !== " ") {
      files.push({
        status: x,
        staged: true,
        path,
        origPath: "RC".includes(x) ? origPath : undefined,
      });
    }
    if (y !== " ") {
      files.push({
        status: y,
        staged: false,
        path,
        origPath: "RC".includes(y) ? origPath : undefined,
      });
    }
  }
  return files;
}

export async function readGitStatus(cwd: string): Promise<GitFileStatus[]> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-z", "-uall"], {
    cwd,
    maxBuffer: 1024 * 1024,
  });
  return parseGitStatus(stdout);
}

/** The lines of a failed git run worth showing: its fatal/error lines, else the last few */
export function gitErrorSummary(err: unknown): string {
  const e = err as { stderr?: unknown; stdout?: unknown; message?: unknown };
  const text =
    String(e?.stderr ?? "").trim() || String(e?.stdout ?? "").trim() || String(e?.message ?? err);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("hint:"));
  const errors = lines.filter((l) => /^(fatal|error):/i.test(l));
  const summary = (errors.length > 0 ? errors : lines.slice(-3)).join("\n");
  return summary.length > 400 ? `${summary.slice(0, 400)}…` : summary;
}

/** Runs git; a failure throws an Error carrying git's own message instead of "Command failed" */
export async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 5 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    throw new Error(gitErrorSummary(err));
  }
}
