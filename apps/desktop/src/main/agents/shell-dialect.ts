// How a command line is written for the shell an agent runs in. macOS and Linux only ever get
// "posix" or "fish" (unchanged); PowerShell and cmd.exe are Windows-only kinds.

export type ShellKind = "posix" | "fish" | "pwsh" | "cmd";

/** File name without folder, and without `.exe` on Windows: `C:\x\pwsh.exe` → `pwsh` */
export function shellBaseName(shellPath: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") return shellPath.split("/").pop() ?? "";
  return (shellPath.split(/[\\/]/).pop() ?? "").replace(/\.exe$/i, "").toLowerCase();
}

export function shellKind(shellPath: string, platform: NodeJS.Platform): ShellKind {
  const name = shellBaseName(shellPath, platform);
  if (platform === "win32") {
    if (name === "pwsh" || name === "powershell") return "pwsh";
    if (name === "cmd") return "cmd";
  }
  return name === "fish" ? "fish" : "posix";
}

/** PowerShell 7 when installed, else Windows PowerShell (always in System32), else cmd.exe */
export function windowsShell(
  env: Record<string, string | undefined>,
  find: (command: string) => string | null,
): string {
  return find("pwsh.exe") ?? find("powershell.exe") ?? env.ComSpec ?? env.COMSPEC ?? "cmd.exe";
}

const PWSH_ESCAPES: Record<string, string> = { "\n": "`n", "\r": "`r", "\t": "`t" };

/**
 * One literal argument. PowerShell gets a one-line double-quoted string (a typed command must
 * not hold a raw newline); smart quotes close a PowerShell string, so they are escaped too.
 * cmd.exe has no newline or `%` escape inside quotes: newlines become spaces.
 */
export function quoteArg(kind: ShellKind, s: string): string {
  if (kind === "pwsh") {
    return `"${s.replace(/[`"$\u201C\u201D\u201E\n\r\t]/g, (c) => PWSH_ESCAPES[c] ?? `\`${c}`)}"`;
  }
  if (kind === "cmd") return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** A path or flag value: bare when nothing in it needs quoting (every POSIX path Exegol writes) */
export function quotePath(kind: ShellKind, s: string): string {
  const bare = kind === "pwsh" || kind === "cmd" ? /^[\w./:\\@+=-]+$/ : /^[\w./:@+=-]+$/;
  return bare.test(s) ? s : quoteArg(kind, s);
}

/** The typed command ends the shell with it: `exec` on POSIX, an explicit exit on Windows */
export function runAndExit(kind: ShellKind, command: string): string {
  if (kind === "pwsh") return `${command}; exit $LASTEXITCODE`;
  if (kind === "cmd") return `${command} & exit`;
  return `exec ${command}`;
}

/** Enter for a command typed into the PTY: ConPTY shells take CR */
export function submitKey(kind: ShellKind): string {
  return kind === "pwsh" || kind === "cmd" ? "\r" : "\n";
}

/** PowerShell flags shared by every Exegol PTY: no banner, and a local integration script may run
 *  under Windows PowerShell's default Restricted policy (this process only) */
const PWSH_FLAGS = ["-NoLogo", "-ExecutionPolicy", "Bypass"];

/** An interactive PowerShell that loads Exegol's integration (cwd, prompt marks, ready marker) */
export function pwshInteractiveArgs(profilePath: string): string[] {
  return [...PWSH_FLAGS, "-NoExit", "-Command", `. ${quoteArg("pwsh", profilePath)}`];
}

/** The shell running one command and exiting; null for cmd.exe, whose quoting through ConPTY's
 *  command line is not safe: it gets the command typed instead */
export function oneShotArgs(kind: ShellKind, command: string): string[] | null {
  if (kind === "pwsh") return [...PWSH_FLAGS, "-Command", command];
  return kind === "cmd" ? null : ["-ic", command];
}
