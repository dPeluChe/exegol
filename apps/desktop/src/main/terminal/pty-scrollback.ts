import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { logger } from "../lib/logger";
import { SCROLLBACK_THROTTLE_MS, type Session } from "./pty-session-types";

/** Emulator revision last written to disk: serialize is 25-40ms per 5000 lines, skip it when nothing changed */
const flushedRevision = new WeakMap<Session, number>();

/** The snapshot to write, or null when the disk copy is already current */
function dirtySnapshot(
  session: Session,
): { path: string; snapshot: string; revision: number } | null {
  const path = session.scrollbackPath;
  if (!path) return null;
  const revision = session.emulator.revision;
  if (flushedRevision.get(session) === revision) return null;
  const snapshot = session.emulator.snapshot();
  return snapshot ? { path, snapshot, revision } : null;
}

export function scheduleScrollbackFlush(session: Session): void {
  if (!session.scrollbackPath || session.flushTimer) return;
  session.flushTimer = setTimeout(() => {
    session.flushTimer = null;
    flushScrollbackAsync(session);
  }, SCROLLBACK_THROTTLE_MS);
}

async function flushScrollbackAsync(session: Session): Promise<void> {
  const dirty = dirtySnapshot(session);
  if (!dirty) return;
  try {
    await mkdir(dirname(dirty.path), { recursive: true });
    await writeFile(dirty.path, dirty.snapshot, "utf-8");
    flushedRevision.set(session, dirty.revision);
  } catch (err) {
    logger.error(`[PtyHost] Scrollback write failed for ${session.id}:`, err);
  }
}

export function flushScrollbackSync(session: Session): void {
  const dirty = dirtySnapshot(session);
  if (!dirty) return;
  try {
    mkdirSync(dirname(dirty.path), { recursive: true });
    writeFileSync(dirty.path, dirty.snapshot, "utf-8");
    flushedRevision.set(session, dirty.revision);
  } catch (err) {
    logger.error(`[PtyHost] Sync scrollback write failed for ${session.id}:`, err);
  }
}
