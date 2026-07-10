import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const execFileAsync = promisify(execFile);

import { projectCreateSchema } from "@exegol/shared";
import { getWorktreeName, removeManagedWorktree } from "../../agents/worktrees";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  listWorktrees,
  removeWorktree,
  renameProject,
  updateProjectGroup,
  updateProjectLastOpened,
  updateProjectSortOrder,
} from "../../db/queries";
import { openInIde } from "../../ide/opener";
import { publicProcedure, router } from "../trpc";

async function isGitRepo(path: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: path,
    });
    return true;
  } catch {
    return false;
  }
}

async function getGitRemote(path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--get", "remote.origin.url"], {
      cwd: path,
    });
    const remote = stdout.trim();
    return remote || null;
  } catch {
    return null;
  }
}

export const projectRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return listProjects(ctx.db);
  }),

  // Returns null (not throws) when project not found: stale persisted
  // activeProjectId is a normal state to recover from, not an error.
  get: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    return getProject(ctx.db, input.id) ?? null;
  }),

  create: publicProcedure.input(projectCreateSchema).mutation(async ({ ctx, input }) => {
    if (!existsSync(input.path)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Path does not exist: ${input.path}`,
      });
    }

    const stats = statSync(input.path);
    if (!stats.isDirectory()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Path is not a directory: ${input.path}`,
      });
    }

    if (!(await isGitRepo(input.path))) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Path is not a git repository: ${input.path}`,
      });
    }

    const gitRemote = input.gitRemote ?? (await getGitRemote(input.path));

    return createProject(ctx.db, {
      ...input,
      gitRemote,
    });
  }),

  rename: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      renameProject(ctx.db, input.id, input.name);
      return getProject(ctx.db, input.id);
    }),

  reorder: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string()) }))
    .mutation(({ ctx, input }) => {
      for (let i = 0; i < input.orderedIds.length; i++) {
        updateProjectSortOrder(ctx.db, input.orderedIds[i] as string, i);
      }
      return { success: true };
    }),

  /** T146: move a project into a group (or ungroup with groupId: null). */
  setGroup: publicProcedure
    .input(z.object({ id: z.string(), groupId: z.string().nullable() }))
    .mutation(({ ctx, input }) => {
      updateProjectGroup(ctx.db, input.id, input.groupId);
      return { success: true };
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const project = getProject(ctx.db, input.id);
    if (!project) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.id} not found` });
    }
    deleteProject(ctx.db, input.id);
    return { success: true };
  }),

  openInIde: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        ide: z.string().optional(),
        customPath: z.string().optional(),
        /** open a specific file (absolute or project-relative) instead of the project root */
        file: z.string().optional(),
        line: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = getProject(ctx.db, input.projectId);
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Project ${input.projectId} not found`,
        });
      }
      // Read user's IDE preference from settings, fallback to project default
      let ide = input.ide;
      if (!ide) {
        const settingsRow = ctx.db
          .prepare("SELECT value FROM settings WHERE key = 'app_settings'")
          .get() as { value: string } | undefined;
        if (settingsRow) {
          try {
            const settings = JSON.parse(settingsRow.value);
            ide = settings.defaultIde;
          } catch {
            /* use fallback */
          }
        }
      }
      ide = ide ?? project.defaultIde ?? "vscode";
      let target = project.path;
      if (input.file) {
        const resolved = input.file.startsWith("/") ? input.file : `${project.path}/${input.file}`;
        if (!existsSync(resolved)) {
          throw new TRPCError({ code: "NOT_FOUND", message: `File not found: ${input.file}` });
        }
        target = resolved;
      }
      await openInIde(target, ide, input.customPath, input.file ? input.line : undefined);
      return { success: true };
    }),

  open: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const project = getProject(ctx.db, input.id);
    if (!project) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.id} not found` });
    }
    updateProjectLastOpened(ctx.db, input.id);
    const updated = getProject(ctx.db, input.id);
    if (!updated) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Project ${input.id} not found after update`,
      });
    }
    return updated;
  }),

  listWorktrees: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      return listWorktrees(ctx.db, input.projectId);
    }),

  /** Delete a worktree (runs archive hook, removes from disk + DB) */
  deleteWorktree: publicProcedure
    .input(
      z.object({ worktreeId: z.string(), projectId: z.string(), force: z.boolean().optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      const wt = ctx.db.prepare("SELECT * FROM worktrees WHERE id = ?").get(input.worktreeId) as
        | { id: string; path: string; branch_name: string }
        | undefined;
      if (!wt) return { success: false, message: "Worktree not found" };

      const project = getProject(ctx.db, input.projectId);
      if (!project) return { success: false, message: "Project not found" };

      // Run archive hook before deletion (T60: exegol.yaml)
      try {
        const { runArchiveHook } = require("../../hooks/project-hooks");
        await runArchiveHook(project.path, wt.path, wt.branch_name);
      } catch {
        /* Non-fatal */
      }

      try {
        removeManagedWorktree(
          project.path,
          getWorktreeName(wt.branch_name),
          wt.path,
          input.force ?? false,
        );
      } catch {
        try {
          require("node:fs").rmSync(wt.path, { recursive: true, force: true });
        } catch {
          /* */
        }
      }

      removeWorktree(ctx.db, wt.id);
      return { success: true, message: "Worktree deleted" };
    }),
});
