import { spawnSync } from "node:child_process";

/** stdout, or null when the command is missing, times out (10 s) or exits outside `okCodes` */
export function run(cmd: string, cmdArgs: string[], okCodes = [0], cwd?: string): string | null {
  const r = spawnSync(cmd, cmdArgs, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
  });
  return r.error || r.status === null || !okCodes.includes(r.status) ? null : r.stdout;
}

export function human(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Disk use without following links, null when du fails or times out */
export function duBytes(path: string): number | null {
  const kb = Number.parseInt(run("du", ["-sk", path])?.split(/\s/)[0] ?? "", 10);
  return Number.isNaN(kb) ? null : kb * 1024;
}
