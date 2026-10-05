import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { logger } from "../lib/logger";
import { SCROLLBACK_THROTTLE_MS, type Session } from "./pty-session-types";

/** Emulator revision last written to disk: serialize is 25-40ms per 5000 lines, skip it when nothing changed */
const flushedRevision = new WeakMap<Session, number>();

/** The snapshot to write, or null when the disk copy is already current */
function dirtySnapshot(session: Session): { snapshot: string; revision: number } | null {
  if (!session.scrollbackPath) return null;
  const revision = session.emulator.revision;
  if (flushedRevision.get(session) === revision) return null;
  const snapshot = session.emulator.snapshot();
  return snapshot ? { snapshot, revision } : null;
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
  if (!dirty || !session.scrollbackPath) return;
  try {
    await mkdir(dirname(session.scrollbackPath), { recursive: true });
    await writeFile(session.scrollbackPath, dirty.snapshot, "utf-8");
    flushedRevision.set(session, dirty.revision);
  } catch (err) {
    logger.error(`[PtyHost] Scrollback write failed for ${session.id}:`, err);
  }
}

export function flushScrollbackSync(session: Session): void {
  const dirty = dirtySnapshot(session);
  if (!dirty || !session.scrollbackPath) return;
  try {
    mkdirSync(dirname(session.scrollbackPath), { recursive: true });
    writeFileSync(session.scrollbackPath, dirty.snapshot, "utf-8");
    flushedRevision.set(session, dirty.revision);
  } catch (err) {
    logger.error(`[PtyHost] Sync scrollback write failed for ${session.id}:`, err);
  }
}
