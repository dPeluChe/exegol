import { execFile } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, release, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BugDiagnostics } from "@exegol/shared";
import type Database from "libsql";
import { LOG_DIR } from "../lib/logger";
import { EXEGOL_REPO_SLUG, EXEGOL_REPO_URL } from "../lib/repo";
import { SIDECAR_LOG } from "../terminal/pty-sidecar-discovery";
import { SIDECAR_VERSION } from "../terminal/pty-sidecar-protocol";
import { runDoctorChecks } from "./doctor";

const execFileAsync = promisify(execFile);

/** GitHub rejects issue bodies past 65536 chars; leave room for the header. */
const MAX_BODY = 60_000;

/**
 * The report goes into a PUBLIC issue. Exegol's own log lines no longer carry
 * prompts, spawn commands or agent output (they log `commandShape` and drop the
 * step text); these rules catch what third-party CLIs and errors put there:
 * credentials, URLs, and paths whose folder names name the user and clients.
 */
const REDACTIONS: Array<[RegExp, string]> = [
  // Credentials first, so a quoted secret is caught whole
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[private key redacted]",
  ],
  [/\bsk-(ant-)?[A-Za-z0-9_-]{16,}/g, "sk-$1[redacted]"],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, "$1_[redacted]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_[redacted]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "xox-[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "AIza[redacted]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA[redacted]"],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[jwt redacted]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[redacted]"],
  [
    /((?:TOKEN|SECRET|PASSWORD|PASSWD|KEY)[A-Z_]*\\?["']?\s*[:=]\s*\\?["']?)[^\s"'\\,}[]{4,}/gi,
    "$1[redacted]",
  ],
  [/("taskDescription"\s*:\s*")(?:[^"\\]|\\.)*"/g, '$1[redacted]"'],
  [/'[^'\n]{3,}'/g, "'[text redacted]'"],
  // URLs: credentials and query strings, and hosts other than local or GitHub.
  // Bounded quantifiers: an unanchored run over a long base64/hex blob was
  // quadratic (seconds on the main process for 100KB)
  [/(\b[a-z][\w+.-]{0,31}:\/\/)[^\s/@"']{1,256}@/gi, "$1[redacted]@"],
  [/(https?:\/\/[^\s?"')]+)\?[^\s"')]+/gi, "$1?[query redacted]"],
  [/https?:\/\/(?!localhost\b|127\.0\.0\.1\b|github\.com\b)[^\s/"')]+/gi, "<url>"],
  [/[\w.+-]{1,64}@[\w-]{1,63}\.[\w.-]{2,63}/g, "<email>"],
  [/\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ip>"],
  // Paths. Home becomes ~ first only so Exegol's own ~/.exegol survives; any
  // other folder under home, or another user's, is generic.
  [/~\/(?!\.exegol\b)[^\s"',)\]]+/g, "~/<path>"],
  [/\/(?:Users|home)\/[^/\s"']+(?:\/[^\s"',)\]]*)?/g, "/<user-path>"],
  [/\/Volumes\/[^\s"',)\]]+/g, "/Volumes/<path>"],
];

export function redact(text: string, home = homedir()): string {
  let out = home ? text.split(home).join("~") : text;
  for (const [re, replacement] of REDACTIONS) out = out.replace(re, replacement);
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

function agentCounts(db: Database.Database): string[] {
  try {
    const rows = db
      .prepare(
        "SELECT cli_type, status, COUNT(*) AS n FROM agents GROUP BY cli_type, status ORDER BY n DESC",
      )
      .all() as { cli_type: string; status: string; n: number }[];
    return rows.map((a) => `- ${a.cli_type} ${a.status}: ${a.n}`);
  } catch {
    return [];
  }
}

export async function collectDiagnostics(
  db: Database.Database,
  app: { getVersion: () => string; isPackaged: boolean },
): Promise<BugDiagnostics> {
  const version = app.getVersion();
  const doctor = await runDoctorChecks(db).catch(() => null);
  const current = tailFile(join(LOG_DIR, "exegol.log"), 300);
  const previous = [1, 2]
    .map((i) => problemLines(join(LOG_DIR, `exegol.${i}.log`), 40))
    .filter(Boolean)
    .join("\n");
  const sidecar = tailFile(SIDECAR_LOG, 80);
  const lastError = [...current.split("\n"), ...previous.split("\n")]
    .reverse()
    .find((l) => l.includes("[ERROR]"));
  const agents = agentCounts(db);

  const section = (title: string, body: string) =>
    body ? `### ${title}\n\n\`\`\`\n${body}\n\`\`\`\n` : `### ${title}\n\n_(empty)_\n`;

  const text = [
    `## Exegol ${version} diagnostics`,
    "",
    `- App: ${version} (${app.isPackaged ? "packaged" : "dev"})`,
    `- Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, Node ${process.versions.node}`,
    `- Darwin ${release()} (${process.platform}-${process.arch})`,
    `- Sidecar protocol ${SIDECAR_VERSION}`,
    "",
    "### Doctor",
    "",
    ...(doctor?.checks.map((c) => `- [${c.status}] ${c.label}: ${c.detail}`) ?? ["_(failed)_"]),
    "",
    "### Agents",
    "",
    ...(agents.length ? agents : ["_(none)_"]),
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

/** `gh` present AND signed in: only then can it file the issue itself. */
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
 * `diag` is what the user reviewed; the description is redacted like the logs.
 */
export async function fileBugReport(
  diag: BugDiagnostics,
  description: string,
): Promise<{ url: string; via: "gh" | "browser" }> {
  const said = redact(description.trim());
  // Defense in depth: the text comes back from the renderer; redact is idempotent
  const text = redact(diag.text);
  const title = `[bug] ${(said.split("\n")[0] || diag.lastError || "Report from Exegol").slice(0, 100)}`;

  if (await ghCanFile()) {
    const file = join(tmpdir(), `exegol-bug-${Date.now()}.md`);
    writeFileSync(file, [said, text].filter(Boolean).join("\n\n").slice(0, MAX_BODY));
    try {
      const { stdout } = await execFileAsync(
        "gh",
        ["issue", "create", "--repo", EXEGOL_REPO_SLUG, "--title", title, "--body-file", file],
        { timeout: 30_000 },
      );
      return { url: stdout.trim().split("\n").pop() ?? EXEGOL_REPO_URL, via: "gh" };
    } finally {
      rmSync(file, { force: true });
    }
  }

  const body = [
    ...(said ? [said, ""] : []),
    `Exegol ${diag.version} on ${process.platform}-${process.arch}`,
    ...(diag.lastError ? [`Last error: \`${diag.lastError.slice(0, 300)}\``] : []),
    "",
    "<!-- Full diagnostics were copied to your clipboard: paste them below -->",
    "",
  ].join("\n");
  const params = new URLSearchParams({ title, body });
  return { url: `${EXEGOL_REPO_URL}/issues/new?${params.toString()}`, via: "browser" };
}
