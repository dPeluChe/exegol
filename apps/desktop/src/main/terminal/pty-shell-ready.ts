import { logger } from "../lib/logger";
import type { Session } from "./pty-session-types";
import { SHELL_READY_MARKER } from "./shell-wrappers";

export function scanForMarker(
  data: string,
  session: Session,
): { processedData: string; markerFound: boolean } {
  if (session.shellReadyState !== "pending") return { processedData: data, markerFound: false };

  let output = "";
  let markerFound = false;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === SHELL_READY_MARKER[session.markerMatchPos]) {
      session.markerHeldBytes += data[i];
      session.markerMatchPos++;
      if (session.markerMatchPos === SHELL_READY_MARKER.length) {
        session.markerHeldBytes = "";
        session.markerMatchPos = 0;
        markerFound = true;
        output += data.slice(i + 1);
        break;
      }
    } else {
      output += session.markerHeldBytes + data[i];
      session.markerHeldBytes = "";
      session.markerMatchPos = 0;
    }
  }
  return { processedData: output, markerFound };
}

/** The marker (or its timeout) ends the gate: held marker bytes become output and queued
 *  writes go out in order through `send` */
export function resolveShellReady(
  session: Session,
  state: "ready" | "timed_out",
  send: (data: string) => void,
): void {
  if (session.shellReadyState !== "pending") return;
  session.shellReadyState = state;
  if (session.shellReadyTimeout) {
    clearTimeout(session.shellReadyTimeout);
    session.shellReadyTimeout = null;
  }
  // A partial match that never completed is regular output
  if (session.markerHeldBytes.length > 0) {
    session.emulator.write(session.markerHeldBytes);
    session.callbacks.onData(session.markerHeldBytes);
    session.markerHeldBytes = "";
  }
  session.markerMatchPos = 0;
  const queue = session.preReadyStdinQueue;
  session.preReadyStdinQueue = [];
  for (const data of queue) send(data);
  if (state === "timed_out") {
    logger.warn(`[PtyHost] Shell ready marker timed out for ${session.id}, unblocking writes`);
  }
}
