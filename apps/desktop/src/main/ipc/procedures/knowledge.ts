/**
 * T140: tRPC procedures for the Project Knowledge Node.
 */

import { existsSync } from "node:fs";
import { z } from "zod";
import { getProject } from "../../db/queries";
import { ensureProjectBrief, writeProjectBrief } from "../../knowledge/brief";
import { getDigestPath, getMemoryBridgePath } from "../../knowledge/paths";
import { importMemoryBridgeAsSeed, syncMemoryBridge } from "../../knowledge/memory-bridge";
import { syncManagedBlock } from "../../knowledge/managed-block";
import { isDigestStale, refreshDigest, refreshDigestIfStale } from "../../knowledge/staleness";
import { publicProcedure, router } from "../trpc";

function requireProjectPath(db: Parameters<typeof getProject>[0], projectId: string): string {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  return project.path;
}

export const knowledgeRouter = router({
  /** Full knowledge-node snapshot for the Knowledge sub-tab. */
  get: publicProcedure.input(z.object({ projectId: z.string() })).query(({ ctx, input }) => {
    const projectPath = requireProjectPath(ctx.db, input.projectId);
    const brief = ensureProjectBrief(projectPath);
    const { digest, refreshed } = refreshDigestIfStale(projectPath);
    const memoryBridgeExists = existsSync(getMemoryBridgePath(projectPath));
    syncManagedBlock(projectPath);

    return {
      brief,
      digest,
      digestRefreshedOnLoad: refreshed,
      digestStale: isDigestStale(projectPath),
      memoryBridgeExists,
    };
  }),

  /** Explicit user save — full overwrite of PROJECT.md. */
  saveBrief: publicProcedure
    .input(z.object({ projectId: z.string(), content: z.string() }))
    .mutation(({ ctx, input }) => {
      const projectPath = requireProjectPath(ctx.db, input.projectId);
      writeProjectBrief(projectPath, input.content);
      syncManagedBlock(projectPath);
      return { success: true };
    }),

  /** Force-regenerate DIGEST.md regardless of staleness. */
  refreshDigest: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ ctx, input }) => {
      const projectPath = requireProjectPath(ctx.db, input.projectId);
      const digest = refreshDigest(projectPath);
      syncManagedBlock(projectPath);
      return { digest };
    }),

  /** Distill top-salience DB facts into MEMORY.md. */
  syncMemoryBridge: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ ctx, input }) => {
      const projectPath = requireProjectPath(ctx.db, input.projectId);
      const content = syncMemoryBridge(ctx.db, input.projectId, projectPath);
      syncManagedBlock(projectPath);
      return { content, path: getDigestPath(projectPath) };
    }),

  /** Import MEMORY.md's facts into the DB (e.g. seeding a fresh clone). */
  importMemoryBridgeAsSeed: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ ctx, input }) => {
      const projectPath = requireProjectPath(ctx.db, input.projectId);
      const imported = importMemoryBridgeAsSeed(ctx.db, input.projectId, projectPath);
      return { imported };
    }),
});
