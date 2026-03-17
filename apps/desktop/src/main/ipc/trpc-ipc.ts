import { ipcMain } from "electron";
import { createContext } from "./context";
import { appRouter } from "./router";

/**
 * Registers a tRPC handler on Electron's IPC main process.
 * Uses createCaller for direct procedure invocation — no HTTP needed.
 * The renderer invokes procedures via: ipcRenderer.invoke('trpc', { path, input })
 *
 * Note: tRPC createCaller returns Proxy objects, so hasOwnProperty doesn't work.
 * We use direct property access with try/catch instead.
 */
export function registerTrpcIpcHandler(): void {
  ipcMain.handle("trpc", async (_event, payload: { path: string; input: unknown }) => {
    const { path, input } = payload;
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);

    try {
      // Navigate the caller proxy using dot-separated path
      // e.g., "projects.list" -> caller.projects.list(input)
      const segments = path.split(".");
      // biome-ignore lint/suspicious/noExplicitAny: tRPC Proxy requires any
      let current: any = caller;

      for (const segment of segments) {
        const next = current[segment];
        if (next === undefined) {
          throw new Error(`Procedure not found: ${path}`);
        }
        current = next;
      }

      if (typeof current !== "function") {
        throw new Error(`Not a callable procedure: ${path}`);
      }

      // tRPC createCaller: pass undefined (not null) for procedures with no input
      return await current(input ?? undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error && typeof error === "object" && "code" in error
          ? // biome-ignore lint/suspicious/noExplicitAny: tRPC Proxy requires any
            (error as any).code
          : "INTERNAL_SERVER_ERROR";
      throw Object.assign(new Error(message), { code });
    }
  });
}
