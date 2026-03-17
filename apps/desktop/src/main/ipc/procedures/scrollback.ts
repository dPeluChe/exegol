import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { app } from "electron";
import { z } from "zod";
import { publicProcedure, router } from "../trpc";

// Only allow safe characters in agentId (nanoid alphabet + underscore/hyphen)
const safeAgentIdPattern = /^[a-zA-Z0-9_-]+$/;

function getScrollbackDir(): string {
  const dir = join(app.getPath("userData"), "scrollback");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getScrollbackPath(agentId: string): string {
  if (!safeAgentIdPattern.test(agentId)) {
    throw new Error(`Invalid agentId: ${agentId}`);
  }
  const dir = getScrollbackDir();
  const filePath = resolve(dir, `${agentId}.log`);
  // Belt-and-suspenders: ensure resolved path stays within scrollback dir
  if (!filePath.startsWith(dir)) {
    throw new Error(`Path traversal detected for agentId: ${agentId}`);
  }
  return filePath;
}

export const scrollbackRouter = router({
  get: publicProcedure.input(z.object({ agentId: z.string() })).query(({ input }) => {
    const filePath = getScrollbackPath(input.agentId);
    if (!existsSync(filePath)) {
      return null;
    }
    return readFileSync(filePath, "utf-8");
  }),

  exists: publicProcedure.input(z.object({ agentId: z.string() })).query(({ input }) => {
    return existsSync(getScrollbackPath(input.agentId));
  }),
});

export { getScrollbackDir, getScrollbackPath };
