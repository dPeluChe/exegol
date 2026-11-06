/** Path text for code that has no `node:path`, or holds two spellings of one folder: the renderer,
 *  and a shell's `C:/x` next to the app's `C:\x`. A POSIX path keeps `\` as a name character, except
 *  in `pathBase` and `pathSegments`, which read labels and take either separator */
const WINDOWS_ROOT = /^(?:[A-Za-z]:[\\/]|\\\\)/;

const trimSeps = (p: string) => p.replace(/[\\/]+$/, "");
const lastSep = (p: string) => Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));

export const isWindowsPath = (p: string) => WINDOWS_ROOT.test(p);

/** The separator this path already uses */
export const pathSep = (p: string) => (isWindowsPath(p) ? "\\" : "/");

export const pathSegments = (p: string) => p.split(/[\\/]+/).filter(Boolean);

export function pathBase(p: string): string {
  const trimmed = trimSeps(p);
  return trimmed.slice(lastSep(trimmed) + 1) || p;
}

export function pathParent(p: string): string {
  const trimmed = trimSeps(p);
  if (!isWindowsPath(p)) return trimmed.slice(0, trimmed.lastIndexOf("/")) || "/";
  const at = lastSep(trimmed);
  if (at < 0) return `${trimmed}\\`;
  const parent = trimmed.slice(0, at);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}${trimmed[at]}` : parent;
}

/** Windows ignores case and takes either separator; POSIX paths compare as written */
function comparable(p: string): string {
  const trimmed = trimSeps(p);
  if (!isWindowsPath(p)) return trimmed;
  return trimmed
    .replace(/\//g, "\\")
    .replace(/^\\\\\?\\/, "")
    .toLowerCase();
}

export const samePath = (a: string, b: string) => comparable(a) === comparable(b);

/** Never true for a bare root: no project contains the whole disk */
export function isUnderPath(path: string, root: string): boolean {
  const key = comparable(root);
  if (!key) return false;
  const sep = isWindowsPath(root) ? "\\" : "/";
  return comparable(path).startsWith(`${key}${sep}`);
}

/** `path` from `root` down, in `path`'s own spelling; null when it is not under it */
export function pathBelow(path: string, root: string): string | null {
  return isUnderPath(path, root) ? trimSeps(path).slice(trimSeps(root).length + 1) : null;
}
