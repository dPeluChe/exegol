import { pickDevServerPort } from "@exegol/shared";
import type { PortInfo } from "../hooks/use-trpc-scheduler";
import { trpcInvoke } from "./trpc-client";

/** Where a new browser pane opens: the project's preferred port, else a running dev server, else :3000 */
export async function projectBrowserUrl(projectId?: string | null, projectPath?: string | null) {
  try {
    if (projectId) {
      const preferred = await trpcInvoke<number | null>("resources.preferredPort", { projectId });
      if (preferred) return `http://localhost:${preferred}`;
    }
    if (projectPath) {
      const ports = await trpcInvoke<PortInfo[]>("resources.ports", { projectPath });
      const port = pickDevServerPort(ports ?? []);
      if (port) return `http://localhost:${port}`;
    }
  } catch {
    /* fall back to the default */
  }
  return "http://localhost:3000";
}
