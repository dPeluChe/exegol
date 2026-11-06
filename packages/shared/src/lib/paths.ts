/** Path text for code that has no `node:path`, or holds a path from another spelling: the renderer,
 *  and a shell's `C:/x` next to the app's `C:\x`. Both separators count everywhere; a name with a
 *  backslash in it on POSIX is the one case read wrong, and only for a label */
const LAST_SEP = /[\\/](?=[^\\/]*$)/;
const WINDOWS_ROOT = /^(?:[A-Za-z]:[\\/]|\\\\)/;

const trimSeps = (p: string) => p.replace(/[\\/]+$/, "");

export const isWindowsPath = (p: string) => WINDOWS_ROOT.test(p);

/** The separator this path already uses */
export const pathSep = (p: string) => (isWindowsPath(p) ? "\\" : "/");

export const pathSegments = (p: string) => p.split(/[\\/]+/).filter(Boolean);

export function pathBase(p: string): string {
  const trimmed = trimSeps(p);
  return trimmed.slice(trimmed.search(LAST_SEP) + 1) || p;
}

export function pathParent(p: string): string {
  const trimmed = trimSeps(p);
  const at = trimmed.search(LAST_SEP);
  if (at < 0) return isWindowsPath(`${trimmed}\\`) ? `${trimmed}\\` : "/";
  const parent = trimmed.slice(0, at);
  if (parent === "") return "/";
  return /^[A-Za-z]:$/.test(parent) ? `${parent}${trimmed[at]}` : parent;
}

/** Windows ignores case and takes either separator; POSIX paths compare as written */
function comparable(p: string): string {
  const trimmed = trimSeps(p);
  return isWindowsPath(p) ? trimmed.replace(/\\/g, "/").toLowerCase() : trimmed;
}

export const samePath = (a: string, b: string) => comparable(a) === comparable(b);

export const isUnderPath = (path: string, root: string) =>
  comparable(path).startsWith(`${comparable(root)}/`);

/** `path` from `root` down, in `path`'s own spelling; null when it is not under it */
export function pathBelow(path: string, root: string): string | null {
  return isUnderPath(path, root) ? trimSeps(path).slice(trimSeps(root).length + 1) : null;
}
