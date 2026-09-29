import { app, BrowserWindow, dialog, powerSaveBlocker } from "electron";
import type Database from "libsql";
import { logger } from "../lib/logger";

const CHECK_MS = 15_000;
let blockerId: number | null = null;
let quitAllowed = false;

/** Agents mid-turn (not idle at a prompt, not plain shells) */
export function workingAgentCount(db: Database.Database): number {
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM agents WHERE status = 'running' AND cli_type != 'shell'")
      .get() as { n: number };
    return row.n;
  } catch {
    return 0;
  }
}

/** Signals and the updater quit on purpose: no dialog in their way */
export function allowQuit(): void {
  quitAllowed = true;
}

/**
 * While agents work: keep the Mac from idle-sleeping (a sleep stalls every agent), and ask
 * before Exegol quits. A sleep attempt quit it mid-work with no warning (2026-09-28). A manual
 * sleep still sleeps; only idle sleep is held.
 */
export function startWorkGuard(db: Database.Database): () => void {
  const sync = () => {
    const working = workingAgentCount(db) > 0;
    if (working && blockerId === null) {
      blockerId = powerSaveBlocker.start("prevent-app-suspension");
      logger.info("[WorkGuard] agents working: holding idle sleep");
    } else if (!working && blockerId !== null) {
      powerSaveBlocker.stop(blockerId);
      blockerId = null;
      logger.info("[WorkGuard] no agent working: idle sleep allowed again");
    }
  };
  const timer = setInterval(sync, CHECK_MS);
  sync();

  const onBeforeQuit = (event: Electron.Event) => {
    if (quitAllowed) return;
    const n = workingAgentCount(db);
    if (n === 0) return;
    event.preventDefault();
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      type: "warning" as const,
      buttons: ["Keep working", "Quit Exegol"],
      defaultId: 0,
      cancelId: 0,
      message: `${n} agent${n === 1 ? " is" : "s are"} still working`,
      detail:
        "Their sessions keep running in the background and reconnect when you reopen Exegol, but a restart or sleep will stop them.",
    };
    const shown = win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
    shown
      .then(({ response }) => {
        logger.info(
          `[WorkGuard] quit with ${n} working agent(s): ${response === 1 ? "confirmed" : "kept"}`,
        );
        if (response === 1) {
          quitAllowed = true;
          app.quit();
        }
      })
      .catch(() => {});
  };
  app.on("before-quit", onBeforeQuit);

  return () => {
    clearInterval(timer);
    app.off("before-quit", onBeforeQuit);
    if (blockerId !== null) powerSaveBlocker.stop(blockerId);
    blockerId = null;
  };
}
