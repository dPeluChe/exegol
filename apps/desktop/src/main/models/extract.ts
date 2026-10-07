import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { type ReadEntry, x as untar } from "tar";
import bz2 from "unbzip2-stream";

export class UnsafeArchiveError extends Error {}

/** Why an entry may not be extracted, null when it is a plain file or folder under rootDir */
export function unsafeEntryReason(path: string, type: string, rootDir: string): string | null {
  if (type !== "File" && type !== "Directory" && type !== "OldFile") return `${type} entry`;
  if (isAbsolute(path) || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "absolute path";
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.includes("..")) return "path traversal";
  if (parts[0] !== rootDir) return "outside the model folder";
  return null;
}

/**
 * Extracts a .tar.bz2 into `tmpDir`, refusing the whole archive on any link,
 * device, absolute or `..` path, then moves `<tmpDir>/<rootDir>` to `destDir`
 * in one rename. Files land as 0644: nothing extracted is executable.
 */
export async function extractTarBz2(opts: {
  archive: string;
  tmpDir: string;
  destDir: string;
  rootDir: string;
  requiredFiles: readonly string[];
}): Promise<void> {
  await rm(opts.tmpDir, { recursive: true, force: true });
  await mkdir(opts.tmpDir, { recursive: true });
  let refused: string | null = null;
  try {
    await pipeline(
      createReadStream(opts.archive),
      bz2(),
      untar({
        cwd: opts.tmpDir,
        strict: true,
        preserveOwner: false,
        filter: (path, stat) => {
          const entry = stat as ReadEntry;
          const reason = unsafeEntryReason(path, entry.type, opts.rootDir);
          entry.mode = entry.type === "Directory" ? 0o755 : 0o644;
          if (reason && !refused) refused = `${reason}: ${path}`;
          return reason === null && refused === null;
        },
      }),
    );
    if (refused) throw new UnsafeArchiveError(`archive refused (${refused})`);
    const extracted = join(opts.tmpDir, opts.rootDir);
    for (const file of opts.requiredFiles) {
      const info = await stat(join(extracted, file)).catch(() => null);
      if (!info?.isFile()) throw new Error(`archive is missing ${file}`);
    }
    await rm(opts.destDir, { recursive: true, force: true });
    await rename(extracted, opts.destDir);
  } finally {
    await rm(opts.tmpDir, { recursive: true, force: true });
  }
}
