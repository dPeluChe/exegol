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
