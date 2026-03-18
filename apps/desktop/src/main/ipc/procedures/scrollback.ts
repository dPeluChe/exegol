import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function getSerializedPath(agentId: string): string {
  if (!safeAgentIdPattern.test(agentId)) {
    throw new Error(`Invalid agentId: ${agentId}`);
  }
  const dir = getScrollbackDir();
  const filePath = resolve(dir, `${agentId}.serialized`);
  if (!filePath.startsWith(dir)) {
    throw new Error(`Path traversal detected for agentId: ${agentId}`);
  }
  return filePath;
}

export const scrollbackRouter = router({
  /** Get scrollback content. Prefers serialized state (colors/formatting intact), falls back to raw log. */
  get: publicProcedure.input(z.object({ agentId: z.string() })).query(({ input }) => {
    // Try serialized state first (higher fidelity: preserves cursor pos, attributes)
    const serializedPath = getSerializedPath(input.agentId);
    if (existsSync(serializedPath)) {
      try {
        return readFileSync(serializedPath, "utf-8");
      } catch {
        // Fall through to raw scrollback
      }
    }

    // Fall back to raw scrollback log
    const filePath = getScrollbackPath(input.agentId);
    if (!existsSync(filePath)) {
      return null;
    }
    return readFileSync(filePath, "utf-8");
  }),

  exists: publicProcedure.input(z.object({ agentId: z.string() })).query(({ input }) => {
    return (
      existsSync(getSerializedPath(input.agentId)) || existsSync(getScrollbackPath(input.agentId))
    );
  }),

  /** Save serialized terminal state (called from renderer when agent stops). */
  saveSerialized: publicProcedure
    .input(z.object({ agentId: z.string(), content: z.string() }))
    .mutation(({ input }) => {
      const filePath = getSerializedPath(input.agentId);
      mkdirSync(getScrollbackDir(), { recursive: true });
      writeFileSync(filePath, input.content, "utf-8");
      return { success: true };
    }),
});

export { getScrollbackDir, getScrollbackPath };
