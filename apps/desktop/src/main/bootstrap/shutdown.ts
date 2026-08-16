/**
 * T176 — a quit that actually quits.
 *
 * The old teardown was one straight-line sequence of synchronous calls. Two
 * things went wrong with that, and both were observed: the app ignored SIGTERM
 * and needed `kill -9`, and a step that throws silently skips every step after
 * it — including `closeDatabase()`, the one you most want to run.
 *
 * Three rules here, in order of how much they buy:
 *
 * 1. **Every step is isolated.** A failing step is logged and the rest still
 *    run. Teardown is a list of independent obligations, not a pipeline.
 * 2. **Every step is timed and named.** We did not know WHICH call hung — the
 *    log now says so the next time it happens, instead of us guessing from a
 *    process tree.
 * 3. **Steps stay synchronous.** Deliberately: `will-quit` does not await, and
 *    pre-ready there is no message loop to return to, so an async step would
 *    simply not finish. That also means a deadline HERE would be theatre — a
 *    timer cannot fire while a synchronous loop holds the thread, and nothing
 *    in the loop yields. The deadline lives where it can actually run, in
 *    `installSignalHandlers`, and the timing log is what identifies a hang.
 */

import { app } from "electron";
import { logger } from "../lib/logger";

export interface TeardownStep {
  name: string;
  run: () => void;
}

/** Past this, the quit is not coming and staying alive helps nobody. */
const FORCE_EXIT_MS = 8_000;
/** A step slower than this gets named in the log even on a clean exit. */
const SLOW_STEP_MS = 250;

let alreadyRan = false;

export function runTeardown(steps: TeardownStep[]): void {
  // will-quit can fire more than once (quit → cancelled → quit), and a second
  // pass over a half-closed database is how a clean exit turns into a crash.
  if (alreadyRan) return;
  alreadyRan = true;

  const startedAt = Date.now();
  for (const step of steps) {
    const stepStart = Date.now();
    try {
      // Void-return assignability lets an async step compile here, and its
      // promise would be neither awaited nor caught. Say so rather than let it
      // look like it worked.
      const result = step.run() as unknown;
      if (result && typeof (result as Promise<void>).then === "function") {
        logger.warn(`[Shutdown] ${step.name} returned a promise — teardown does not await`);
      }
    } catch (err) {
      logger.warn(`[Shutdown] ${step.name} failed (continuing):`, err);
    }
    const took = Date.now() - stepStart;
    if (took >= SLOW_STEP_MS) logger.warn(`[Shutdown] ${step.name} took ${took}ms`);
  }

  logger.info(`[Shutdown] teardown complete in ${Date.now() - startedAt}ms`);
}

/**
 * Electron does not quit on SIGTERM by default, which is why `kill` appeared to
 * do nothing and only `kill -9` worked. Ask for a normal quit first — teardown
 * still runs — and hard-exit if the app is still here shortly after, since a
 * second SIGTERM that also does nothing is worse than an abrupt exit.
 */
let forceExitTimer: ReturnType<typeof setTimeout> | null = null;

export function installSignalHandlers(onForceExit: () => void): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      logger.info(`[Shutdown] ${signal} received — quitting`);
      app.quit();
      // app.quit() returns immediately, so this timer CAN fire — unlike one
      // wrapped around the synchronous teardown. Armed once: repeated signals
      // should not stack exits. NOT unref'd: it is the last resort, so it must
      // be able to hold the loop open long enough to run.
      if (forceExitTimer) return;
      forceExitTimer = setTimeout(() => {
        // app.exit() emits neither before-quit nor will-quit, so forcing
        // without this would leave the database open — the outcome this whole
        // module argues against. runTeardown's guard makes it safe to call
        // even if will-quit already ran.
        logger.warn(`[Shutdown] quit did not complete in ${FORCE_EXIT_MS}ms — forcing exit`);
        try {
          onForceExit();
        } catch (err) {
          logger.warn("[Shutdown] forced teardown failed:", err);
        }
        app.exit(0);
      }, FORCE_EXIT_MS);
    });
  }
}
