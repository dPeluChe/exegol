import { execFileAsync } from "../lib/exec-file";

export interface ProcRow {
  pid: number;
  ppid: number;
  /** Process group, and the foreground group of its terminal (0 without one). Not on Windows */
  pgid?: number;
  tpgid?: number;
  /** Controlling terminal (`ttys003`), "??" without one. Not on Windows */
  tty?: string;
  /** Resident memory in KB */
  rss?: number;
  args: string;
}

let inFlight: Promise<ProcRow[]> | null = null;

/** Every process on the machine, one `ps` for all the terminals watched. Callers at the same
 *  time (a tab closing several terminals, the promotion poll) share one read */
export function readProcessTable(): Promise<ProcRow[]> {
  inFlight ??= (process.platform === "win32" ? readWin32Table() : readTable()).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function readTable(): Promise<ProcRow[]> {
  const { stdout } = await execFileAsync(
    "ps",
    ["-A", "-o", "pid=,ppid=,pgid=,tpgid=,tty=,rss=,args="],
    {
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const rows: ProcRow[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    if (m) {
      rows.push({
        pid: Number(m[1]),
        ppid: Number(m[2]),
        pgid: Number(m[3]),
        tpgid: Number(m[4]),
        tty: m[5],
        rss: Number(m[6]),
        args: m[7] ?? "",
      });
    }
  }
  return rows;
}

// Windows has no ps; tasklist has no parent pid. CIM has both (and the command line)
const WIN32_QUERY =
  "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine | ConvertTo-Json -Compress";

async function readWin32Table(): Promise<ProcRow[]> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", WIN32_QUERY],
    { timeout: 10_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
  return parseWin32Processes(stdout);
}

interface Win32Process {
  ProcessId?: number;
  ParentProcessId?: number;
  WorkingSetSize?: number;
  CommandLine?: string | null;
}

/** ConvertTo-Json output: an array, or a bare object for a single process */
export function parseWin32Processes(json: string): ProcRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.trim() || "[]");
  } catch {
    return [];
  }
  const list = (Array.isArray(parsed) ? parsed : [parsed]) as Win32Process[];
  return list.flatMap((p) =>
    typeof p?.ProcessId === "number"
      ? [
          {
            pid: p.ProcessId,
            ppid: p.ParentProcessId ?? 0,
            rss: Math.round((p.WorkingSetSize ?? 0) / 1024),
            args: p.CommandLine ?? "",
          },
        ]
      : [],
  );
}
