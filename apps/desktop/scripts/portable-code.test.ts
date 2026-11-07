import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** macOS-only habits that reached main before Windows ever ran them */
const BANNED: { pattern: RegExp; use: string }[] = [
  { pattern: /\.split\("\/"\)/g, use: "pathBase or pathSegments from @exegol/shared" },
  { pattern: /\.startsWith\("\/"\)/g, use: "isAbsolute from node:path, or isWindowsPath" },
  { pattern: /lastIndexOf\("\/"\)/g, use: "pathBase or pathParent from @exegol/shared" },
  { pattern: /\/dev\/null/g, use: "execFileAsync with no shell: cmd.exe has no /dev/null" },
  { pattern: /\bcommand -v\b/g, use: "commandOnPath from agents/spawn-env" },
  { pattern: /promisify\(execFile\)/g, use: "execFileAsync from lib/exec-file: it hides consoles" },
];

/** Hits that are fine, with why. A count, so a new hit in a listed file still fails */
const ALLOWED: Record<string, { hits: number; why: string }> = {
  "src/main/lib/exec-file.ts": { hits: 1, why: "the one wrapper" },
  "src/main/terminal/pty-sidecar-discovery.ts": {
    hits: 1,
    why: "ps behind a win32 guard, sidecar",
  },
  "src/main/terminal/shell-wrappers.ts": { hits: 3, why: "POSIX zsh and bash wrappers" },
  "src/main/agents/shell-dialect.ts": { hits: 1, why: "its POSIX branch" },
  "src/main/agents/spawn-env.ts": { hits: 1, why: "Claude hook, skipped on Windows" },
  "src/main/agents/worktree-local-files.ts": { hits: 2, why: "git's relative paths" },
  "src/main/lib/worktree-janitor-rule.ts": { hits: 2, why: "git's relative paths" },
  "src/main/lib/worktree-safety.ts": { hits: 1, why: "git's relative paths" },
  "src/main/skills/installer.ts": { hits: 1, why: "an owner/repo name" },
  "src/main/system/dev-servers.ts": { hits: 1, why: "lsof output, off on Windows" },
  "src/main/files-preview/preview-paths.ts": { hits: 1, why: "a URL pathname" },
  "src/main/dictation/media-pause.ts": { hits: 1, why: "Linux playerctl script" },
  "src/renderer/components/workspace/HtmlPreview.tsx": { hits: 1, why: "a URL" },
  "src/renderer/components/workspace/sections/diff/diff-parser.ts": {
    hits: 2,
    why: "git diff's own marker",
  },
  "src/renderer/lib/add-project.ts": { hits: 1, why: "POSIX half of isAbsoluteFolder" },
};

const ROOT = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}

describe("portable code", () => {
  const found = new Map<string, string[]>();
  for (const file of sources(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf-8");
    const key = relative(ROOT, file).replaceAll("\\", "/");
    const hits = BANNED.flatMap(({ pattern, use }) =>
      [...text.matchAll(pattern)].map((m) => `${m[0]}: use ${use}`),
    );
    if (hits.length > 0) found.set(key, hits);
  }

  it("has no new macOS-only habit", () => {
    const extra = [...found].filter(([file, hits]) => hits.length > (ALLOWED[file]?.hits ?? 0));
    expect(extra).toEqual([]);
  });

  it("keeps the allowed list honest", () => {
    const stale = Object.entries(ALLOWED).filter(
      ([file, { hits }]) => (found.get(file)?.length ?? 0) < hits,
    );
    expect(stale).toEqual([]);
  });
});
