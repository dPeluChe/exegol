import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MODEL_ID_PATTERN, MODEL_LAUNCH, YOLO_FLAGS } from "@exegol/shared";
import { providerBinaries } from "../agents/cli-catalog";
import { getProviderRegistry } from "../agents/registry";

const execFileAsync = promisify(execFile);

interface ProcRow {
  pid: number;
  ppid: number;
  args: string;
}

/** Interpreters whose script (the next token) names the CLI: `node .../codex` */
const RUNTIMES = new Set(["node", "bun", "deno", "python", "python3"]);

function cliNames(args: string): string[] {
  const [first = "", second = ""] = args.trim().split(/\s+/);
  const base = (t: string) => t.split("/").pop() ?? "";
  return RUNTIMES.has(base(first)) ? [base(second)] : [base(first)];
}

/** For each shell, the first CLI (by provider command) running anywhere below it */
export function matchShellClis(
  shells: { id: string; pid: number }[],
  rows: ProcRow[],
  commandToProvider: Map<string, string>,
  /** Filled with the matched CLI's command line, per shell (the flags it was typed with) */
  argsOut?: Record<string, string>,
): Record<string, string> {
  const children = new Map<number, ProcRow[]>();
  for (const r of rows) children.set(r.ppid, [...(children.get(r.ppid) ?? []), r]);
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

/** Every process on the machine, one `ps` for all the terminals watched */
export async function readProcessTable(): Promise<ProcRow[]> {
  const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,args="], {
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const rows: ProcRow[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] ?? "" });
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
