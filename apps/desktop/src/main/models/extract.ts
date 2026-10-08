import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EXTRACT_TIMEOUT_MS = 10 * 60_000;

export class UnsafeArchiveError extends Error {}

/** Why an extracted entry may not be kept, null for a plain file or folder */
export function unsafeEntryReason(info: {
  isFile(): boolean;
  isDirectory(): boolean;
  nlink: number;
}): string | null {
  if (info.isDirectory()) return null;
  if (!info.isFile()) return "link or special file";
  if (info.nlink > 1) return "hard link";
  return null;
}

/** Walks `dir` without following links: refuses anything but plain files and folders, forces 0644/0755 */
async function sanitizeTree(dir: string): Promise<void> {
  const queue = [dir];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const info = await lstat(next);
    const reason = unsafeEntryReason(info);
    if (reason) throw new UnsafeArchiveError(`archive refused (${reason})`);
    if (info.isDirectory()) {
      await chmod(next, 0o755);
      for (const name of await readdir(next)) queue.push(join(next, name));
    } else {
      await chmod(next, 0o644);
    }
  }
}

/** A required file, or a folder on the way to one: everything else in a model folder is an extra */
export function keepsPath(rel: string, required: readonly string[]): boolean {
  return required.some((file) => file === rel || file.startsWith(`${rel}/`));
}

/** Removes what the engine never reads (test_wavs/, READMEs) from `dir`, without following links.
 *  Returns the removed paths, relative to `dir` */
export async function pruneToRequired(
  dir: string,
  required: readonly string[],
  rel = "",
): Promise<string[]> {
  const removed: string[] = [];
  for (const name of await readdir(join(dir, rel)).catch(() => [] as string[])) {
    const path = rel ? posix.join(rel, name) : name;
    const info = await lstat(join(dir, path));
    if (info.isDirectory() && keepsPath(path, required)) {
      removed.push(...(await pruneToRequired(dir, required, path)));
    } else if (!(info.isFile() && required.includes(path))) {
      await rm(join(dir, path), { recursive: true, force: true });
      removed.push(path);
    }
  }
  return removed;
}

/**
 * Extracts a .tar.bz2 with the system tar (bsdtar on macOS, GNU tar on Linux: both
 * refuse absolute and `..` paths without -P) into `tmpDir`, refuses the whole archive
 * on any link or special file, keeps only the required files, then moves `<tmpDir>/<rootDir>` to `destDir` in one rename.
 */
export async function extractTarBz2(opts: {
  archive: string;
  tmpDir: string;
  destDir: string;
  rootDir: string;
  requiredFiles: readonly string[];
  signal?: AbortSignal;
}): Promise<void> {
  await rm(opts.tmpDir, { recursive: true, force: true });
  await mkdir(opts.tmpDir, { recursive: true });
  try {
    await execFileAsync(
      "tar",
      ["-xjf", opts.archive, "-C", opts.tmpDir, "--no-same-owner", "--no-same-permissions"],
      { signal: opts.signal, timeout: EXTRACT_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    ).catch((err: { stderr?: string; code?: string | number }) => {
      if (opts.signal?.aborted) throw err;
      // stderr names archive members; err.message would carry the home path of the command line
      const detail = err.stderr?.trim().split("\n")[0] || `exit ${err.code ?? "unknown"}`;
      throw new UnsafeArchiveError(`archive refused (tar: ${detail})`);
    });
    const extracted = join(opts.tmpDir, opts.rootDir);
    await sanitizeTree(opts.tmpDir);
    for (const file of opts.requiredFiles) {
      const info = await stat(join(extracted, file)).catch(() => null);
      if (!info?.isFile()) throw new Error(`archive is missing ${file}`);
    }
    await pruneToRequired(extracted, opts.requiredFiles);
    await rm(opts.destDir, { recursive: true, force: true });
    await rename(extracted, opts.destDir);
  } finally {
    await rm(opts.tmpDir, { recursive: true, force: true });
  }
}
