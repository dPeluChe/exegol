import { execFileAsync } from "../../lib/exec-file";

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
