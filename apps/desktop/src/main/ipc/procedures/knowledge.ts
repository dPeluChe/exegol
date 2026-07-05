/**
 * T140: tRPC procedures for the Project Knowledge Node.
 */

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { getProject } from "../../db/queries";
import { ensureProjectBrief, readProjectBrief, writeProjectBrief } from "../../knowledge/brief";
import { syncManagedBlock } from "../../knowledge/managed-block";
import { importMemoryBridgeAsSeed, syncMemoryBridge } from "../../knowledge/memory-bridge";
import { getDigestPath, getMemoryBridgePath } from "../../knowledge/paths";
import { isDigestStale, refreshDigest, refreshDigestIfStale } from "../../knowledge/staleness";
import { publicProcedure, router } from "../trpc";

function requireProjectPath(db: Parameters<typeof getProject>[0], projectId: string): string {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  return project.path;
}

export const knowledgeRouter = router({
  /**
   * Full knowledge-node snapshot for the Knowledge sub-tab. STRICTLY read-only:
   * a query must never write to the user's repo (react-query refires it on
   * focus/refetch — creating files from here dirtied git status on tab open).
   * File creation lives in `initialize`/`refreshDigest`/`saveBrief` mutations.
   */
  get: publicProcedure.input(z.object({ projectId: z.string() })).query(({ ctx, input }) => {
    const projectPath = requireProjectPath(ctx.db, input.projectId);
    const brief = readProjectBrief(projectPath);
    const digestPath = getDigestPath(projectPath);
    const digest = existsSync(digestPath) ? readFileSync(digestPath, "utf-8") : null;
    const memoryBridgeExists = existsSync(getMemoryBridgePath(projectPath));

    return {
      initialized: brief !== null,
      brief,
      digest,
      digestStale: isDigestStale(projectPath),
      memoryBridgeExists,
    };
  }),

  /**
   * Explicit opt-in: create the knowledge base (PROJECT.md template, first
   * DIGEST.md, managed block — creating AGENTS.md if no context file exists).
   */
  initialize: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(({ ctx, input }) => {
      const projectPath = requireProjectPath(ctx.db, input.projectId);
      const brief = ensureProjectBrief(projectPath);
      const { digest } = refreshDigestIfStale(projectPath);
      syncManagedBlock(projectPath, { createIfMissing: true });
      return { brief, digest };
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
      return { content, path: getMemoryBridgePath(projectPath) };
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
