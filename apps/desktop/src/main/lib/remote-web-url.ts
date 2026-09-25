/**
 * The browsable page of a git remote: `git@github.com:o/r.git` and
 * `https://user:token@gitlab.com/o/r.git` both become `https://host/o/r`.
 * Credentials in the remote are dropped (the URL is shown and opened).
 */
export function remoteWebUrl(remote: string): string | null {
  const r = remote.trim();
  const scp = r.match(/^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  try {
    const u = new URL(r);
    if (!["https:", "http:", "ssh:", "git:"].includes(u.protocol)) return null;
    const path = u.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "");
    if (!path || path === "/") return null;
    return `https://${u.hostname}${path}`;
  } catch {
    return null;
  }
}
