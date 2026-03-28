import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const execFileAsync = promisify(execFile);

import { projectCreateSchema } from "@exegol/shared";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  listWorktrees,
  updateProjectLastOpened,
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

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const project = getProject(ctx.db, input.id);
    if (!project) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.id} not found` });
    }
    return project;
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
      await openInIde(project.path, ide, input.customPath);
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
});
