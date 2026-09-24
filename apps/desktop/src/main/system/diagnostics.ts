import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir, release, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type Database from "libsql";
import { LOG_DIR } from "../lib/logger";
import { EXEGOL_REPO_SLUG, EXEGOL_REPO_URL } from "../lib/repo";
import { SIDECAR_LOG } from "../terminal/pty-sidecar-discovery";
import { SIDECAR_VERSION } from "../terminal/pty-sidecar-protocol";
import { runDoctorChecks } from "./doctor";

const execFileAsync = promisify(execFile);

/** GitHub rejects issue bodies past 65536 chars; leave room for the header. */
const MAX_BODY = 60_000;

type Replacer = string | ((substring: string, ...groups: string[]) => string);

/** A spawn command keeps its binary and flags; prompts, paths and values go. */
function commandShape(cmd: string): string {
  const [bin, ...rest] = cmd.split(/\s+/);
  const flags = rest.filter((t) => /^--?[A-Za-z][\w-]*$/.test(t));
  return [bin?.split("/").pop(), ...flags, rest.length > flags.length ? "<args>" : ""]
    .filter(Boolean)
    .join(" ");
}

/**
 * The report goes into a PUBLIC issue, and logs carry the user's paths (whose
 * folder names name clients), the prompts they gave agents, raw agent output
 * and sometimes a credential a CLI printed. Structure first (commands reduced
 * to their shape, agent text dropped, paths made generic), then patterns.
 */
const REDACTIONS: Array<[RegExp, Replacer]> = [
  // Structure: spawn commands and task text never leave
  [/("fullCommand"\s*:\s*")((?:[^"\\]|\\.)*)"/g, (_m, p, cmd) => `${p}${commandShape(cmd)}"`],
  [/("taskDescription"\s*:\s*")(?:[^"\\]|\\.)*"/g, '$1[redacted]"'],
  // Status lines carry up to 120 chars of raw agent output as their step
  [/(\[AgentCallback\] Status change:[^\n[]*?) \[[^\n]*\]$/gm, "$1 [step redacted]"],
  [/'[^'\n]{3,}'/g, "'[text redacted]'"],
  // Credentials
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[private key redacted]",
  ],
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, "sk-ant-[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]"],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, "$1_[redacted]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_[redacted]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "xox-[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "AIza[redacted]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA[redacted]"],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[jwt redacted]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[redacted]"],
  [
    /((?:TOKEN|SECRET|PASSWORD|PASSWD|KEY)[A-Z_]*\\?["']?\s*[:=]\s*\\?["']?)[^\s"'\\,}]{4,}/gi,
    "$1[redacted]",
  ],
  // URLs: credentials and query strings, and hosts other than local or GitHub
  [/(\b[a-z][\w+.-]*:\/\/)[^\s/@"']+@/gi, "$1[redacted]@"],
  [/(https?:\/\/[^\s?"')]+)\?[^\s"')]+/gi, "$1?[query redacted]"],
  [/https?:\/\/(?!localhost\b|127\.0\.0\.1\b|github\.com\b)[^\s/"')]+/gi, "<url>"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>"],
  [/\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ip>"],
  // Paths: folder names identify the user and their clients. Exegol's own
  // ~/.exegol tree is safe and useful to keep.
  [/~\/(?!\.exegol\b)[^\s"',)\]]+/g, "~/<path>"],
  [/\/(?:Users|home)\/[^/\s"']+(?:\/[^\s"',)\]]*)?/g, "/<user-path>"],
  [/\/Volumes\/[^\s"',)\]]+/g, "/Volumes/<path>"],
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
  diag: Diagnostics,
  description: string,
): Promise<{ url: string; via: "gh" | "browser" }> {
  const said = redact(description.trim());
  const title = `[bug] ${(said.split("\n")[0] || diag.lastError || "Report from Exegol").slice(0, 100)}`;

  if (await ghCanFile()) {
    const body = [said, diag.text].filter(Boolean).join("\n\n").slice(0, MAX_BODY);
    const file = join(tmpdir(), `exegol-bug-${Date.now()}.md`);
    writeFileSync(file, body);
    const { stdout } = await execFileAsync(
      "gh",
      ["issue", "create", "--repo", EXEGOL_REPO_SLUG, "--title", title, "--body-file", file],
      { timeout: 30_000 },
    );
    return { url: stdout.trim().split("\n").pop() ?? EXEGOL_REPO_URL, via: "gh" };
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
