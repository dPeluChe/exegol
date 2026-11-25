import { newSidecarSession } from "./pty-host-reattach";
import type { SpawnPayload } from "./pty-ipc";
import { type Session, type SessionCallbacks, SHELL_READY_TIMEOUT_MS } from "./pty-session-types";
import type { SidecarClient } from "./pty-sidecar-client";
import { SHELL_RING_BUFFER_CAPACITY } from "./pty-sidecar-protocol";

export async function doCreateSidecar(
  client: SidecarClient,
  sessions: Map<string, Session>,
  resolveShellReady: (session: Session, state: "ready" | "timed_out") => void,
  id: string,
  spawnOpts: SpawnPayload,
  callbacks: SessionCallbacks,
  options?: { scrollbackPath?: string; shellReadyGating?: boolean; smallRingBuffer?: boolean },
): Promise<{ pid: number }> {
  const session = newSidecarSession(
    id,
    spawnOpts,
    callbacks,
    options?.scrollbackPath,
    options?.shellReadyGating ? "pending" : "unsupported",
  );
  session.lastSeq = 0;
  sessions.set(id, session);

  if (session.shellReadyState === "pending") {
    session.shellReadyTimeout = setTimeout(() => {
      resolveShellReady(session, "timed_out");
    }, SHELL_READY_TIMEOUT_MS);
  }

  const result = await client.createSession({
    id,
    shell: spawnOpts.shell,
    args: spawnOpts.args,
    cwd: spawnOpts.cwd,
    cols: spawnOpts.cols,
    rows: spawnOpts.rows,
    env: spawnOpts.env,
    bufferCapacity: options?.smallRingBuffer ? SHELL_RING_BUFFER_CAPACITY : undefined,
  });

  session.pid = result.pid;
  return { pid: result.pid };
}
