/**
 * tRPC client that communicates via Electron IPC.
 * All procedure calls are routed through window.api.trpc.invoke
 * which is bridged to the main process by the preload script.
 */

const IPC_WRAPPER = /^Error invoking remote method '[^']*': (?:(\w+): )?/;

/** Electron rejects with "Error invoking remote method 'trpc': CONFLICT: <message>" and drops
 *  every other field: this gives back the main process's message and its tRPC `code` */
export function unwrapIpcError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const match = IPC_WRAPPER.exec(err.message);
  if (!match) return err;
  const name = match[1];
  const code =
    (err as Error & { code?: string }).code ?? (name && /^[A-Z_]+$/.test(name) ? name : undefined);
  return Object.assign(new Error(err.message.slice(match[0].length)), code ? { code } : {});
}

/**
 * Call a tRPC query procedure by dot-separated path.
 * @example trpcInvoke<Project[]>('projects.list')
 * @example trpcInvoke<Project>('projects.get', { id: '123' })
 */
export async function trpcInvoke<T = unknown>(path: string, input?: unknown): Promise<T> {
  try {
    return (await window.api.trpc.invoke(path, input === undefined ? undefined : input)) as T;
  } catch (err) {
    throw unwrapIpcError(err);
  }
}

/**
 * Call a tRPC mutation procedure by dot-separated path.
 * Same as trpcInvoke but semantically distinct for clarity.
 * @example trpcMutate<Project>('projects.create', { name: 'my-project', path: '/...' })
 */
export const trpcMutate = trpcInvoke;
