import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

/**
 * Returns true if `target` is inside `base` (or equal to it).
 *
 * Uses `relative()` so a base of `/repo/app` never matches `/repo/app-evil`
 * (startsWith would allow that prefix).
 */
export function isPathInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Resolves symlinks by walking up to the nearest existing ancestor.
 * This handles both symlinked base paths (e.g. macOS /tmp → /private/tmp)
 * and non-existent targets (files about to be created).
 */
export async function realpathSafe(p: string): Promise<string> {
  const abs = resolve(p);
  let current = abs;
  const missing: string[] = [];

  while (true) {
    try {
      const real = await realpath(current);
      return missing.length ? join(real, ...missing.reverse()) : real;
    } catch {
      const parent = resolve(current, "..");
      if (parent === current) return abs; // hit filesystem root — give up
      missing.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

/**
 * Checks that `filePath` resolves to a location inside one of the `allowedBases`.
 * Returns true if allowed, false if denied.
 *
 * Both the target and each base are realpath-resolved to defeat symlink traversal.
 */
export async function isPathAllowed(filePath: string, allowedBases: string[]): Promise<boolean> {
  const target = await realpathSafe(filePath);
  for (const base of allowedBases) {
    const resolvedBase = await realpathSafe(base);
    if (isPathInside(resolvedBase, target)) return true;
  }
  return false;
}
