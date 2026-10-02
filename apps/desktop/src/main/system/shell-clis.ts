import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MODEL_ID_PATTERN, MODEL_LAUNCH, YOLO_FLAGS } from "@exegol/shared";
import { providerBinaries } from "../agents/cli-catalog";
import { getProviderRegistry } from "../agents/registry";

const execFileAsync = promisify(execFile);

export interface ProcRow {
  pid: number;
  ppid: number;
  /** Process group, and the foreground group of its terminal (0 without one) */
  pgid?: number;
  tpgid?: number;
  /** Controlling terminal (`ttys003`), "??" without one */
  tty?: string;
  args: string;
}

/** Interpreters whose script (the next token) names the CLI: `node .../codex` */
const RUNTIMES = new Set(["node", "bun", "deno", "python", "python3"]);

const base = (t: string) => t.split("/").pop() ?? "";

/** The command line from the program on: `node /x/codex --y` → [`codex`, `--y`] */
function programTokens(args: string): string[] {
  const tokens = args.trim().split(/\s+/);
  const rest = RUNTIMES.has(base(tokens[0] ?? "")) ? tokens.slice(1) : tokens;
  return [base(rest[0] ?? ""), ...rest.slice(1)];
}

function cliNames(args: string): string[] {
  return programTokens(args).slice(0, 1);
}

/** For each shell, the command its terminal runs in the foreground; null at the prompt */
export function foregroundCommands(
  shells: { id: string; pid: number }[],
  rows: ProcRow[],
): Record<string, string | null> {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const out: Record<string, string | null> = {};
  for (const shell of shells) {
    const row = byPid.get(shell.pid);
    const leader = row?.tpgid && row.tpgid !== row.pgid ? byPid.get(row.tpgid) : undefined;
    out[shell.id] = leader ? programTokens(leader.args).join(" ").slice(0, 60) : null;
  }
  return out;
}

/** ppid → its child processes */
export function childrenByParent(rows: ProcRow[]): Map<number, ProcRow[]> {
  const children = new Map<number, ProcRow[]>();
  for (const r of rows) {
    const siblings = children.get(r.ppid);
    if (siblings) siblings.push(r);
    else children.set(r.ppid, [r]);
  }
  return children;
}

/** For each shell, the first CLI (by provider command) running anywhere below it */
export function matchShellClis(
  shells: { id: string; pid: number }[],
  rows: ProcRow[],
  commandToProvider: Map<string, string>,
  /** Filled with the matched CLI's command line, per shell (the flags it was typed with) */
  argsOut?: Record<string, string>,
): Record<string, string> {
  const children = childrenByParent(rows);
  const found: Record<string, string> = {};
  for (const shell of shells) {
    let level = children.get(shell.pid) ?? [];
    for (let depth = 0; depth < 6 && level.length > 0 && !found[shell.id]; depth++) {
      for (const r of level) {
        const provider = cliNames(r.args)
          .map((n) => commandToProvider.get(n))
          .find(Boolean);
        if (provider) {
          found[shell.id] = provider;
          if (argsOut) argsOut[shell.id] = r.args;
          break;
        }
      }
      level = level.flatMap((r) => children.get(r.pid) ?? []);
    }
  }
  return found;
}

/** The launch choices a CLI typed by hand carries, so a resume keeps them: its YOLO flag and a
 *  model given by flag (`--model x` or `--model=x`) */
export function launchFlagsFromArgs(
  cliType: string,
  args: string,
): { yolo: boolean; model: string | null } {
  const tokens = args.trim().split(/\s+/);
  const yoloFlag = YOLO_FLAGS[cliType];
  const launch = MODEL_LAUNCH[cliType];
  let model: string | null = null;
  if (launch && "flag" in launch) {
    const at = tokens.indexOf(launch.flag);
    const inline = tokens.find((t) => t.startsWith(`${launch.flag}=`));
    const value = at >= 0 ? tokens[at + 1] : inline?.slice(launch.flag.length + 1);
    if (value && MODEL_ID_PATTERN.test(value)) model = value;
  }
  return { yolo: !!yoloFlag && tokens.includes(yoloFlag), model };
}

let inFlight: Promise<ProcRow[]> | null = null;

/** Every process on the machine, one `ps` for all the terminals watched. Callers at the same
 *  time (a tab closing several terminals, the promotion poll) share one read */
export function readProcessTable(): Promise<ProcRow[]> {
  inFlight ??= readTable().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function readTable(): Promise<ProcRow[]> {
  const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,pgid=,tpgid=,tty=,args="], {
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const rows: ProcRow[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+(.*)$/);
    if (m) {
      rows.push({
        pid: Number(m[1]),
        ppid: Number(m[2]),
        pgid: Number(m[3]),
        tpgid: Number(m[4]),
        tty: m[5],
        args: m[6] ?? "",
      });
    }
  }
  return rows;
}

/** Binary name → provider id. Renamed binaries count too: `kilo` in a shell is Kilo Code */
export function providerCommands(): Map<string, string> {
  return new Map(
    getProviderRegistry()
      .list()
      .filter((p) => p.id !== "shell" && p.command && !p.command.startsWith("__"))
      .flatMap((p) => providerBinaries(p.command).map((c) => [c, p.id] as const)),
  );
}
