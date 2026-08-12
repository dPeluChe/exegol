import { logger } from "../lib/logger";

// Startup timing: measure from app ready to first paint.
// Logged once on ready-to-show to give us real numbers vs. competitors' claims.
const startupTimings: Record<string, number> = {};
const startupLogged = new Set<string>();

export const startMark = (label: string) => {
  startupTimings[label] = Date.now();
};

export const endMark = (label: string, from = "appReady") => {
  if (startupLogged.has(label)) return; // only log once per app lifetime
  const start = startupTimings[from];
  if (start) {
    startupLogged.add(label);
    logger.info(`[Startup] ${label}: ${Date.now() - start}ms`);
  }
};
