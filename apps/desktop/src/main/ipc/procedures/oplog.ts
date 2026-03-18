import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createOplogEntry, listAgentOplog, listProjectOplog } from "../../db/queries";
import { logger } from "../../lib/logger";
import { publicProcedure, router } from "../trpc";

// ─── Rust native module (git2 revert) ──────────────────────────────────────

let coreRust: typeof import("@exegol/core-rust") | null = null;
try {
  coreRust = require("@exegol/core-rust");
} catch {
  logger.warn("[Oplog] @exegol/core-rust not available — undo disabled");
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const oplogRouter = router({
  /** List oplog entries for a project */
  listProject: publicProcedure
    .input(z.object({ projectId: z.string(), limit: z.number().default(100) }))
    .query(({ ctx, input }) => {
      return listProjectOplog(ctx.db, input.projectId, input.limit);
    }),

  /** List oplog entries for a specific agent */
  listAgent: publicProcedure.input(z.object({ agentId: z.string() })).query(({ ctx, input }) => {
    return listAgentOplog(ctx.db, input.agentId);
  }),

  /** Undo an operation by reverting to ref_before.
   *  Creates a new "revert" commit — never force-pushes.
   */
  undo: publicProcedure.input(z.object({ oplogId: z.string() })).mutation(({ ctx, input }) => {
    if (!coreRust) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Rust native module not available — cannot undo",
      });
    }

    const entry = ctx.db.prepare("SELECT * FROM oplog WHERE id = ?").get(input.oplogId) as
      | Record<string, unknown>
      | undefined;

    if (!entry) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Oplog entry not found" });
    }

    const refBefore = entry.ref_before as string | null;
    if (!refBefore) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No ref_before recorded — cannot undo this operation",
      });
    }

    // Resolve project path
    const projectId = entry.project_id as string;
    const project = ctx.db.prepare("SELECT path FROM projects WHERE id = ?").get(projectId) as
      | { path: string }
      | undefined;

    if (!project) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }

    // Get current HEAD before revert
    const snapshotBefore = coreRust.getRepoSnapshot(project.path);

    // Perform the revert
    const newSha = coreRust.revertToSnapshot(project.path, refBefore);

    // Record the revert in oplog
    const revertEntry = createOplogEntry(ctx.db, {
      agentId: entry.agent_id as string,
      projectId,
      operation: "revert",
      refBefore: snapshotBefore.headSha,
      refAfter: newSha,
      description: `Reverted to ${refBefore.slice(0, 8)}`,
    });

    logger.info("[Oplog] Undo completed:", {
      oplogId: input.oplogId,
      revertedTo: refBefore.slice(0, 8),
      newCommit: newSha.slice(0, 8),
    });

    return revertEntry;
  }),
});
