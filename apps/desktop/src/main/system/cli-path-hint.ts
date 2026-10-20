import { posix } from "node:path";

// POSIX shells only (the hint is an rc-file line): POSIX paths whatever the host
const { basename, delimiter, dirname, resolve } = posix;

/** The installed CLI's folder is not on PATH (~/.local/bin on some distros): the line to add
 *  and where, else null. `pathEnv` is the login shell's PATH */
export function cliPathHint(
  target: string,
  pathEnv: string,
  home: string,
  shell = "",
): { line: string; file: string } | null {
  const dir = dirname(resolve(target));
  const onPath = pathEnv
    .split(delimiter)
    .filter(Boolean)
    .some((d) => resolve(d.replace(/^~(?=\/|$)/, home)) === dir);
  if (onPath) return null;
  const root = resolve(home);
  const shown = dir.startsWith(`${root}/`) ? `$HOME${dir.slice(root.length)}` : dir;
  if (basename(shell) === "fish") {
    return { line: `fish_add_path ${shown}`, file: "~/.config/fish/config.fish" };
  }
  return {
    line: `export PATH="${shown}:$PATH"`,
    file: basename(shell) === "zsh" ? "~/.zshrc" : "~/.bashrc",
  };
}
