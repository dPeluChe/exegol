// After a sidecar stopped under the running app: a successor for the resumes. The old one may
// still be killing its sessions for a few seconds; reconnecting to it put resumes in a process
// about to exit (live test, 2026-10-12), so its exit is awaited first.
import type { SidecarClient } from "./pty-sidecar-client";

/** The stopping sidecar gets SIGKILL escalation at 2 s; past this we go on anyway */
export const OLD_SIDECAR_EXIT_WAIT_MS = 5_000;

export interface ReconnectDeps {
  oldPid: number | null;
  waitForExit(pid: number, waitMs: number): Promise<void>;
  isProcessAlive(pid: number): boolean;
  ensureSidecar(): Promise<SidecarClient>;
}

/** A sidecar that is not the stopping one; null when discovery could only find that one */
export async function successorSidecar(deps: ReconnectDeps): Promise<SidecarClient | null> {
  if (deps.oldPid) await deps.waitForExit(deps.oldPid, OLD_SIDECAR_EXIT_WAIT_MS);
  const client = await deps.ensureSidecar();
  if (deps.oldPid && client.pid === deps.oldPid && deps.isProcessAlive(deps.oldPid)) {
    client.disconnect();
    return null;
  }
  return client;
}
