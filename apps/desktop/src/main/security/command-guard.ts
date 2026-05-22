/**
 * Shell-command guard. Refuses obviously destructive commands at the spawn
 * boundary. Side-effect free; callers decide how to log + surface the refusal.
 *
 * The patterns are deliberately conservative — false positives (refusing an
 * exotic but benign `rm`) are acceptable; false negatives are not. Lifted from
 * Terax `src/modules/ai/lib/security.ts` and adapted to the boundaries Exegol
 * actually exposes (we don't accept multi-line scripts at the boundary, but
 * the patterns still defend against an attacker collapsing one to a single
 * line).
 */

export type CommandRefusalReason =
  | "fork-bomb"
  | "rm-rf-root"
  | "dd-of-disk"
  | "curl-pipe-sh"
  | "bidi-chars";

export type CommandRefusal =
  | { ok: true }
  | { ok: false; reason: CommandRefusalReason; matched: string };

// Bidi formatting chars (Trojan Source). Same range as path-guard.
const BIDI_CHAR_RE = /[‪-‮⁦-⁩‎‏؜]/u;

// Normalize the command string before pattern matching: strip leading
// backslashes in front of words (`\rm` → `rm`) and collapse empty-string
// quoting that the shell would otherwise erase (`r''m` / `r""m` → `rm`,
// `e""cho` → `echo`). The original string is kept for the `matched` field;
// we only normalize the comparison surface. This closes the most common
// trivial-evasion vectors against `\bword\b` patterns below.
function normalizeCommand(cmd: string): string {
  let s = cmd.replace(/\\([A-Za-z])/g, "$1");
  s = s.replace(/(?<=[A-Za-z])(?:''|"")+(?=[A-Za-z])/g, "");
  return s;
}

// Fork bomb. Matches `:(){ :|:& };:` with arbitrary whitespace between tokens.
const FORK_BOMB_RE = /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/;

// `rm -rf /` — flags may be combined (`-rf`, `-fr`, `-Rf`, `-rfv`, etc.) or
// supplied as long options. The trailing target is `/` (optionally quoted)
// followed by end / shell separator. We also forbid `--no-preserve-root`.
const RM_RF_ROOT_RE =
  /\brm\b\s+(?:[^|;&\n]*\s)?(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|--recursive(?:\s+--force)?|--force\s+--recursive)\s+(?:['"]?\/['"]?)(?=\s|$|;|&|\|)/i;

// `rm -rf ~` / `$HOME` / `${HOME}` — wiping the user's home dir.
const RM_RF_HOME_RE =
  /\brm\b\s+(?:[^|;&\n]*\s)?(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+(?:['"]?(?:~|\$HOME|\$\{HOME\})['"]?)(?=\s|$|;|&|\|)/i;

// `rm -rf .` / `..` / `*` at top level — wildcards or current/parent dir.
const RM_RF_RELATIVE_RE =
  /\brm\b\s+(?:[^|;&\n]*\s)?(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+(?:['"]?(?:\.|\.\.|\*)['"]?)(?=\s|$|;|&|\|)/i;

const NO_PRESERVE_ROOT_RE = /--no-preserve-root\b/i;

// `dd of=/dev/{disk,sd,hd,nvme}*` — direct device writes. Match `dd` as a
// command word, then look for `of=/dev/...` anywhere before a pipe/redirect.
const DD_OF_DISK_RE = /\bdd\b[^|;&\n]*\bof=\/dev\/(?:disk|sd|hd|nvme)/i;

// `curl ... | sh` / `wget ... | /bin/sh` / `curl ... | dash` etc.
// After the pipe accept either a bare shell name OR an absolute path ending in
// a known shell. `[\w./-]*` consumes path prefix; final alternation enumerates
// every common Unix shell rather than relying on a brittle letter prefix.
const SHELL_NAMES = "(?:sh|bash|zsh|ksh|dash|ash|csh|tcsh|fish)";
const CURL_PIPE_SH_RE = new RegExp(
  `\\b(?:curl|wget|fetch)\\b[^|;&\\n]*\\|\\s*(?:[\\w./-]*\\/)?${SHELL_NAMES}\\b`,
  "i",
);

function firstMatch(input: string, re: RegExp): string | null {
  const m = input.match(re);
  return m ? m[0] : null;
}

export function inspectCommand(cmd: string): CommandRefusal {
  if (typeof cmd !== "string" || cmd.length === 0) return { ok: true };
  // Bidi check runs against the raw string — normalization would strip
  // characters we want to surface.
  const bidi = firstMatch(cmd, BIDI_CHAR_RE);
  if (bidi !== null) return { ok: false, reason: "bidi-chars", matched: bidi };

  const c = normalizeCommand(cmd);

  const fork = firstMatch(c, FORK_BOMB_RE);
  if (fork !== null) return { ok: false, reason: "fork-bomb", matched: fork };

  const rmRoot =
    firstMatch(c, RM_RF_ROOT_RE) ??
    firstMatch(c, RM_RF_HOME_RE) ??
    firstMatch(c, RM_RF_RELATIVE_RE) ??
    firstMatch(c, NO_PRESERVE_ROOT_RE);
  if (rmRoot !== null) return { ok: false, reason: "rm-rf-root", matched: rmRoot };

  const dd = firstMatch(c, DD_OF_DISK_RE);
  if (dd !== null) return { ok: false, reason: "dd-of-disk", matched: dd };

  const pipe = firstMatch(c, CURL_PIPE_SH_RE);
  if (pipe !== null) return { ok: false, reason: "curl-pipe-sh", matched: pipe };

  return { ok: true };
}
