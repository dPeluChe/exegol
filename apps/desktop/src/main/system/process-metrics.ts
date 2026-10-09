import { execFileAsync } from "../lib/exec-file";

export interface ProcessMetrics {
  cpu: number;
  /** RSS in bytes */
  memory: number;
}

/** `ps -o pid=,pcpu=,rss=` output, by pid */
export function parsePsMetrics(stdout: string): Map<number, ProcessMetrics> {
  const metrics = new Map<number, ProcessMetrics>();
  for (const line of stdout.trim().split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const pid = Number.parseInt(parts[0] ?? "0", 10);
    const cpu = Number.parseFloat(parts[1] ?? "0");
    const rss = Number.parseInt(parts[2] ?? "0", 10) * 1024;
    if (pid > 0) metrics.set(pid, { cpu, memory: rss });
  }
  return metrics;
}

/** One `ps` for every pid; throws when ps fails (exit 1 when none of them runs) */
export async function readProcessMetrics(pids: number[]): Promise<Map<number, ProcessMetrics>> {
  const { stdout } = await execFileAsync("ps", ["-o", "pid=,pcpu=,rss=", "-p", pids.join(",")], {
    timeout: 3_000,
  });
  return parsePsMetrics(stdout);
}
