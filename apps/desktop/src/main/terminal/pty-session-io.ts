import {
  encodeFrame,
  encodeJson,
  encodeString,
  FRAME_KILL,
  FRAME_RESIZE,
  FRAME_WRITE,
} from "./pty-ipc";
import type { Session } from "./pty-session-types";
import type { SidecarClient } from "./pty-sidecar-client";
import { trackSidecarCall } from "./sidecar-health-watch";

/** The calls a keystroke or pane depends on: the health watch sees each one */
export function callSidecar(
  client: SidecarClient | null,
  method: string,
  id: string,
  call: (client: SidecarClient) => Promise<void>,
): void {
  if (!client) return;
  trackSidecarCall(method, id, call(client), client);
}

export function resizePty(
  client: SidecarClient | null,
  s: Session,
  cols: number,
  rows: number,
): void {
  if (s.mode === "sidecar") {
    callSidecar(client, "session.resize", s.id, (c) => c.resize(s.id, cols, rows));
    return;
  }
  try {
    s.child?.stdin?.write(encodeJson(FRAME_RESIZE, { cols, rows }));
  } catch {
    /* pipe broken */
  }
}

export function killPty(client: SidecarClient | null, s: Session): void {
  const id = s.id;
  if (s.mode === "sidecar") {
    callSidecar(client, "session.kill", id, (c) => c.kill(id));
    return;
  }
  try {
    s.child?.stdin?.write(encodeFrame(FRAME_KILL, Buffer.alloc(0)));
  } catch {
    /* pipe broken */
  }
}

/** A write past the shell-ready gate */
export function sendNow(client: SidecarClient | null, s: Session, data: string): void {
  if (s.mode === "sidecar") {
    callSidecar(client, "session.write", s.id, (c) => c.write(s.id, data));
    return;
  }
  try {
    s.child?.stdin?.write(encodeString(FRAME_WRITE, data));
  } catch {
    /* pipe broken */
  }
}
