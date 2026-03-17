/**
 * tRPC client that communicates via Electron IPC.
 * All procedure calls are routed through window.api.trpc.invoke
 * which is bridged to the main process by the preload script.
 */

/**
 * Call a tRPC query procedure by dot-separated path.
 * @example trpcInvoke<Project[]>('projects.list')
 * @example trpcInvoke<Project>('projects.get', { id: '123' })
 */
export async function trpcInvoke<T = unknown>(
  path: string,
  input?: unknown,
): Promise<T> {
  const result = await window.api.trpc.invoke(path, input === undefined ? undefined : input)
  return result as T
}

/**
 * Call a tRPC mutation procedure by dot-separated path.
 * Same as trpcInvoke but semantically distinct for clarity.
 * @example trpcMutate<Project>('projects.create', { name: 'my-project', path: '/...' })
 */
export async function trpcMutate<T = unknown>(
  path: string,
  input?: unknown,
): Promise<T> {
  const result = await window.api.trpc.invoke(path, input === undefined ? undefined : input)
  return result as T
}
