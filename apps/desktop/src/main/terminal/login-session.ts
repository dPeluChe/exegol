// A sidecar that outlived a macOS login session keeps the old session's services: its terminals
// cannot reach the pasteboard, the DNS configuration or the keychain. Only a new sidecar fixes it.
import { execFileAsync } from "../lib/exec-file";
import { parseEtime } from "../lib/ps-etime";

/** Rows of `ps -axo uid=,pid=,etime=,comm=`: true when `pid` is older than the user's newest
 *  loginwindow. A sidecar is spawned by the app, so one older than the login is from a past one */
export function startedBeforeLogin(table: string, uid: number, pid: number): boolean {
  let own: number | null = null;
  let login: number | null = null;
  for (const line of table.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m || Number(m[1]) !== uid) continue;
    const age = parseEtime(m[3] as string);
    if (age === null) continue;
    if (Number(m[2]) === pid) own = age;
    else if (/\/loginwindow$/.test(m[4] as string))
      login = login === null ? age : Math.min(login, age);
  }
  return own !== null && login !== null && own > login;
}

export async function sidecarOutlivedLogin(pid: number): Promise<boolean> {
  if (process.platform !== "darwin" || !process.getuid) return false;
  const { stdout } = await execFileAsync("ps", ["-axo", "uid=,pid=,etime=,comm="], {
    timeout: 5_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return startedBeforeLogin(stdout, process.getuid(), pid);
}
