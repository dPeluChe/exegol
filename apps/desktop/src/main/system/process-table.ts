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
  /** ps %cpu: per core, so up to 100 x cores. Not on Windows */
  cpu?: number;
  args: string;
}

/** Reads the table through `read`: callers at the same time share one read, and one that passes
 *  `maxAgeMs` takes the last result while it is that recent. `recent` never reads */
export function createProcessTableReader(read: () => Promise<ProcRow[]>, now = Date.now) {
  let inFlight: Promise<ProcRow[]> | null = null;
  let last: { at: number; rows: ProcRow[] } | null = null;
  const recent = (maxAgeMs: number): ProcRow[] | null =>
    last && now() - last.at <= maxAgeMs ? last.rows : null;
  const reader = (opts?: { maxAgeMs?: number }): Promise<ProcRow[]> => {
    const cached = opts?.maxAgeMs === undefined ? null : recent(opts.maxAgeMs);
    if (cached) return Promise.resolve(cached);
    if (!inFlight) {
      const at = now();
      inFlight = read()
        .then((rows) => {
          last = { at, rows };
          return rows;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };
  return Object.assign(reader, { recent });
}

/** Every process on the machine, one `ps` for all the terminals watched. Callers at the same
 *  time (a tab closing several terminals, the promotion poll) share one read; the promotion poll
 *  and the metrics collector also share a recent one (`maxAgeMs`) */
export const readProcessTable = createProcessTableReader(() =>
  process.platform === "win32" ? readWin32Table() : readTable(),
);

async function readTable(): Promise<ProcRow[]> {
  const { stdout } = await execFileAsync(
    "ps",
    ["-A", "-o", "pid=,ppid=,pgid=,tpgid=,tty=,rss=,%cpu=,args="],
    {
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return parsePsTable(stdout);
}

/** pid, ppid, rss and %cpu of every process: no `args`, a few KB where the full table is
 *  hundreds. For callers that only sum usage and find no recent full table */
export async function readProcessUsage(): Promise<ProcRow[]> {
  const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,rss=,%cpu="], {
    timeout: 5000,
  });
  return parsePsUsage(stdout);
}

export function parsePsUsage(stdout: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+(?:[.,]\d+)?)$/);
    if (m) {
      rows.push({
        pid: Number(m[1]),
        ppid: Number(m[2]),
        rss: Number(m[3]),
        cpu: Number((m[4] ?? "0").replace(",", ".")),
        args: "",
      });
    }
  }
  return rows;
}

export function parsePsTable(stdout: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of stdout.split("\n")) {
    const m = line
      .trim()
      .match(/^(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+(\d+)\s+(\d+(?:[.,]\d+)?)\s+(.*)$/);
    if (m) {
      rows.push({
        pid: Number(m[1]),
        ppid: Number(m[2]),
        pgid: Number(m[3]),
        tpgid: Number(m[4]),
        tty: m[5],
        rss: Number(m[6]),
        // A comma locale prints 1,5
        cpu: Number((m[7] ?? "0").replace(",", ".")),
        args: m[8] ?? "",
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
