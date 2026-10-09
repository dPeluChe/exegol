import { app, BrowserWindow, dialog, powerSaveBlocker } from "electron";
import type Database from "libsql";
import { logger } from "../lib/logger";

const CHECK_MS = 15_000;
let blockerId: number | null = null;
let quitAllowed = false;

/** Agent sessions (not plain shells): `working` are mid-turn, `open` also counts the ones at a prompt */
export function agentSessionCounts(db: Database.Database): { working: number; open: number } {
  try {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(status = 'running'), 0) AS working,
                COALESCE(SUM(status IN ('running', 'spawning', 'waiting_input')), 0) AS open
         FROM agents WHERE cli_type != 'shell'`,
      )
      .get() as { working: number; open: number };
    return { working: Number(row.working), open: Number(row.open) };
  } catch {
    return { working: 0, open: 0 };
  }
}

/** Signals and the updater quit on purpose: no dialog in their way */
export function allowQuit(): void {
  quitAllowed = true;
}

/**
 * While agents work, keep the Mac from idle-sleeping (a sleep stalls every agent); while any agent
 * session is open, ask before Exegol quits, which also stops a logout the system started on its
 * own. A manual sleep still sleeps; only idle sleep is held.
 */
export function startWorkGuard(db: Database.Database): () => void {
  const sync = () => {
    const working = agentSessionCounts(db).working > 0;
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
    // Any open session, not only a working one: macOS's auto-logout after inactivity quit Exegol
    // while its agents sat waiting for permission (2026-09-29); an app that asks stops the logout
    const { working, open: n } = agentSessionCounts(db);
    if (n === 0) return;
    event.preventDefault();
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      type: "warning" as const,
      buttons: ["Keep working", "Quit Exegol"],
      defaultId: 0,
      cancelId: 0,
      message:
        working > 0
          ? `${working} agent${working === 1 ? " is" : "s are"} still working`
          : `${n} agent session${n === 1 ? " is" : "s are"} open`,
      detail:
        "Their sessions keep running in the background and reconnect when you reopen Exegol, but a restart or sleep will stop them.",
    };
    const shown = win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
    shown
      .then(({ response }) => {
        logger.info(
          `[WorkGuard] quit with ${n} open agent session(s), ${working} working: ${response === 1 ? "confirmed" : "kept"}`,
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
