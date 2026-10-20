import path from "node:path";

/** A path as printed in a terminal, made absolute: `~/` against home, the rest against cwd.
 *  Windows also prints `~\` */
export function resolveLinkPath(
  text: string,
  cwd: string,
  home: string,
  { isAbsolute, resolve, sep } = path,
): string {
  if (text === "~" || text.startsWith("~/") || text.startsWith(`~${sep}`)) {
    return resolve(home, text.slice(2));
  }
  if (isAbsolute(text)) return resolve(text);
  return resolve(cwd, text);
}
