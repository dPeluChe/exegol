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
 * 3. **There is a deadline.** If teardown has not finished, the process exits
 *    anyway. Honest limitation: a JS timer cannot interrupt a *synchronous*
 *    block, so this saves us from async stalls and from a slow-but-progressing
 *    teardown — not from a blocking syscall. That is why step 2 matters: the
 *    real fix for a sync hang is to stop doing that work here, and the log is
 *    what tells us which work it is.
 */

import { app } from "electron";
import { logger } from "../lib/logger";

export interface TeardownStep {
  name: string;
  run: () => void;
}

/** Past this, something is wrong and staying alive helps nobody. */
const DEADLINE_MS = 8_000;
/** A step slower than this gets named in the log even on a clean exit. */
const SLOW_STEP_MS = 250;

let alreadyRan = false;

export function runTeardown(steps: TeardownStep[]): void {
  // will-quit can fire more than once (quit → cancelled → quit), and a second
  // pass over a half-closed database is how a clean exit turns into a crash.
  if (alreadyRan) return;
  alreadyRan = true;

  const deadline = setTimeout(() => {
    logger.warn(`[Shutdown] teardown exceeded ${DEADLINE_MS}ms — forcing exit`);
    app.exit(0);
  }, DEADLINE_MS);
  deadline.unref?.();

  const startedAt = Date.now();
  for (const step of steps) {
    const stepStart = Date.now();
    try {
      step.run();
    } catch (err) {
      logger.warn(`[Shutdown] ${step.name} failed (continuing):`, err);
    }
    const took = Date.now() - stepStart;
    if (took >= SLOW_STEP_MS) logger.warn(`[Shutdown] ${step.name} took ${took}ms`);
  }

  clearTimeout(deadline);
  logger.info(`[Shutdown] teardown complete in ${Date.now() - startedAt}ms`);
}

/**
 * Electron does not quit on SIGTERM by default, which is why `kill` appeared to
 * do nothing and only `kill -9` worked. Ask for a normal quit first — teardown
 * still runs — and hard-exit if the app is still here shortly after, since a
 * second SIGTERM that also does nothing is worse than an abrupt exit.
 */
export function installSignalHandlers(): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      logger.info(`[Shutdown] ${signal} received — quitting`);
      app.quit();
      const force = setTimeout(() => app.exit(0), DEADLINE_MS);
      force.unref?.();
    });
  }
}
