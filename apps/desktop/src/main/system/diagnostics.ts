import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir, release, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type Database from "libsql";
import { LOG_DIR } from "../lib/logger";
import { EXEGOL_REPO, EXEGOL_REPO_URL } from "../lib/repo";
import { SIDECAR_LOG } from "../terminal/pty-sidecar-discovery";
import { SIDECAR_VERSION } from "../terminal/pty-sidecar-protocol";
import { runDoctorChecks } from "./doctor";

const execFileAsync = promisify(execFile);

/** GitHub rejects issue bodies past 65536 chars; leave room for the header. */
const MAX_BODY = 60_000;

type Replacer = string | ((substring: string, ...groups: string[]) => string);

/**
 * Logs carry the user's home path, the prompts they gave agents (inside spawn
 * commands) and, from a CLI's own output, sometimes a key. A report is meant to
 * be pasted into a public issue, so all of it goes before anything leaves.
 */
const REDACTIONS: Array<[RegExp, Replacer]> = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, "sk-ant-[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]"],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, "$1_[redacted]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_[redacted]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "xox-[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "AIza[redacted]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[redacted]"],
  [
    /((?:TOKEN|SECRET|PASSWORD|API_?KEY)[A-Z_]*\\?["']?\s*[:=]\s*\\?["']?)[^\s"'\\,}]{6,}/gi,
    "$1[redacted]",
  ],
  // Prompts: quoted arguments in spawn commands, and task descriptions
  [/'[^']{20,}'/g, "'[text redacted]'"],
  [/\\"(?:[^"\\]|\\[^"]){20,}?\\"/g, '\\"[text redacted]\\"'],
  [/("taskDescription"\s*:\s*")(?:[^"\\]|\\.)*"/g, '$1[redacted]"'],
];

export function redact(text: string, home = homedir()): string {
  let out = home ? text.split(home).join("~") : text;
  for (const [re, replacement] of REDACTIONS) {
    out = out.replace(re, replacement as string);
  }
  return out;
}

/** Last `lines` lines of a file, reading only its tail (a session log can be large). */
export function tailFile(path: string, lines: number, maxBytes = 512 * 1024): string {
  if (!existsSync(path)) return "";
  const size = statSync(path).size;
  const start = Math.max(0, size - maxBytes);
  const buf = Buffer.alloc(size - start);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, buf.length, start);
  } finally {
    closeSync(fd);
  }
  const all = buf.toString("utf8").split("\n");
  // The first line of a partial read is cut mid-way
  if (start > 0) all.shift();
  return all.slice(-lines).join("\n").trimEnd();
}

function problemLines(path: string, limit: number): string {
  return tailFile(path, 5000)
    .split("\n")
    .filter((l) => /\[(ERROR|WARN)\]/.test(l))
    .slice(-limit)
    .join("\n");
}

export interface Diagnostics {
  /** Full redacted report (markdown) */
  text: string;
  version: string;
  /** Last error line, redacted: becomes the default issue title */
  lastError: string | null;
}

export async function collectDiagnostics(
  db: Database.Database,
  app: { getVersion: () => string; isPackaged: boolean },
): Promise<Diagnostics> {
  const version = app.getVersion();
  const log = join(LOG_DIR, "exegol.log");

  const doctor = await runDoctorChecks(db).catch(() => null);
  const agents = (() => {
    try {
      return db
        .prepare(
          "SELECT cli_type, status, COUNT(*) AS n FROM agents GROUP BY cli_type, status ORDER BY n DESC",
        )
        .all() as { cli_type: string; status: string; n: number }[];
    } catch {
      return [];
    }
  })();

  const current = tailFile(log, 300);
  const previous = [1, 2]
    .map((i) => problemLines(join(LOG_DIR, `exegol.${i}.log`), 40))
    .filter(Boolean)
    .join("\n");
  const sidecar = tailFile(SIDECAR_LOG, 80);
  const lastError =
    [current, previous]
      .join("\n")
      .split("\n")
      .filter((l) => l.includes("[ERROR]"))
      .pop() ?? null;

  const section = (title: string, body: string) =>
    body ? `### ${title}\n\n\`\`\`\n${body}\n\`\`\`\n` : `### ${title}\n\n_(empty)_\n`;

  const text = [
    `## Exegol ${version} diagnostics`,
    "",
    `- App: ${version} (${app.isPackaged ? "packaged" : "dev"})`,
    `- Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, Node ${process.versions.node}`,
    `- macOS/Darwin ${release()} (${process.platform}-${process.arch})`,
    `- Sidecar protocol ${SIDECAR_VERSION}`,
    "",
    "### Doctor",
    "",
    ...(doctor?.checks.map((c) => `- [${c.status}] ${c.label}: ${c.detail}`) ?? ["_(failed)_"]),
    "",
    "### Agents",
    "",
    ...(agents.length ? agents.map((a) => `- ${a.cli_type} ${a.status}: ${a.n}`) : ["_(none)_"]),
    "",
    section("Log (this session, last 300 lines)", current),
    section("Warnings and errors (previous two sessions)", previous),
    section("Sidecar log (last 80 lines)", sidecar),
  ].join("\n");

  return {
    text: redact(text),
    version,
    lastError: lastError ? redact(lastError).replace(/^\S+ \[ERROR\] /, "") : null,
  };
}

async function ghCanFile(): Promise<boolean> {
  try {
    await execFileAsync("gh", ["auth", "status"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * File the report: through `gh` when it is signed in (the full diagnostics fit
 * in the issue), otherwise a prefilled new-issue URL, since a URL can only carry
 * a few KB. The caller copies the full text to the clipboard for that case.
 */
export async function fileBugReport(
  diag: Diagnostics,
  description: string,
): Promise<{ url: string; via: "gh" | "browser" }> {
  const title = `[bug] ${(description.split("\n")[0] || diag.lastError || "Report from Exegol").slice(0, 100)}`;
  const intro = description.trim() ? `${redact(description.trim())}\n\n` : "";

  if (await ghCanFile()) {
    const body = `${intro}${diag.text}`.slice(0, MAX_BODY);
    const file = join(tmpdir(), `exegol-bug-${Date.now()}.md`);
    writeFileSync(file, body);
    const { stdout } = await execFileAsync(
      "gh",
      [
        "issue",
        "create",
        "--repo",
        `${EXEGOL_REPO.owner}/${EXEGOL_REPO.name}`,
        "--title",
        title,
        "--body-file",
        file,
      ],
      { timeout: 30_000 },
    );
    return { url: stdout.trim().split("\n").pop() ?? EXEGOL_REPO_URL, via: "gh" };
  }

  const body = [
    intro.trim(),
    `Exegol ${diag.version} on ${process.platform}-${process.arch}`,
    diag.lastError ? `Last error: \`${diag.lastError.slice(0, 300)}\`` : "",
    "",
    "<!-- Full diagnostics were copied to your clipboard: paste them below -->",
    "",
  ]
    .filter((l, i) => l || i > 1)
    .join("\n");
  const params = new URLSearchParams({ title, body });
  return { url: `${EXEGOL_REPO_URL}/issues/new?${params.toString()}`, via: "browser" };
}
