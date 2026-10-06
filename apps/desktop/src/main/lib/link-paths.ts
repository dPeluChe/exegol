import { isAbsolute, resolve } from "node:path";

/** A path as printed in a terminal, made absolute: `~/` against home, the rest against cwd */
export function resolveLinkPath(text: string, cwd: string, home: string): string {
  if (text === "~" || text.startsWith("~/")) return resolve(home, text.slice(2));
  if (isAbsolute(text)) return resolve(text);
  return resolve(cwd, text);
}
