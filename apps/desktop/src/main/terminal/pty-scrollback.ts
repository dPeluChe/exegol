import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { logger } from "../lib/logger";
import { SCROLLBACK_THROTTLE_MS, type Session } from "./pty-session-types";

export function scheduleScrollbackFlush(session: Session): void {
  if (!session.scrollbackPath || session.flushTimer) return;
  session.flushTimer = setTimeout(() => {
    session.flushTimer = null;
    flushScrollbackAsync(session);
  }, SCROLLBACK_THROTTLE_MS);
}

export async function flushScrollbackAsync(session: Session): Promise<void> {
  if (!session.scrollbackPath) return;
  const snapshot = session.emulator.snapshot();
  if (!snapshot) return;
  try {
    await mkdir(dirname(session.scrollbackPath), { recursive: true });
    await writeFile(session.scrollbackPath, snapshot, "utf-8");
  } catch (err) {
    logger.error(`[PtyHost] Scrollback write failed for ${session.id}:`, err);
  }
}

export function flushScrollbackSync(session: Session): void {
  if (!session.scrollbackPath) return;
  const snapshot = session.emulator.snapshot();
  if (!snapshot) return;
  try {
    mkdirSync(dirname(session.scrollbackPath), { recursive: true });
    writeFileSync(session.scrollbackPath, snapshot, "utf-8");
  } catch (err) {
    logger.error(`[PtyHost] Sync scrollback write failed for ${session.id}:`, err);
  }
}
