import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

const execFileAsync = promisify(execFile);

import { MAX_BROWSER_HOSTS, parseBrowserHosts, projectCreateSchema } from "@exegol/shared";
import { coreRust } from "../../agents/spawn-env";
import { getWorktreeName, removeManagedWorktree } from "../../agents/worktrees";
import { copyCookiesForHosts, markCookiesMigrated } from "../../browser/electron-host";
import {
  createProject,
  deleteProject,
  getProject,
  getWorktreeByAgentId,
  listAllWorktreeRows,
  listProjects,
  listWorktrees,
  removeWorktree,
  renameProject,
  updateProjectGroup,
  updateProjectLastOpened,
  updateProjectSortOrder,
} from "../../db/queries";
import { countLiveAgentsInWorktree, listLiveAgentIds } from "../../db/queries/agents";
import { setProjectBrowserEval, setProjectBrowserHosts } from "../../db/queries/projects";
import { runArchiveHook } from "../../hooks/project-hooks";
import { openInIde, resolveIde, setProjectIde } from "../../ide/opener";
import { runNative } from "../../lib/concurrency";
import { logger } from "../../lib/logger";
import { isPathAllowed } from "../../security/path-guard";
import {
  adoptDetectedIcon,
  detectProjectIcons,
  iconDataUrl,
  isIconFile,
} from "../../system/project-icons";
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

const appearanceSchema = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  icon: z.string().max(40).nullable(),
  iconImage: z.string().nullable(),
});

/** Color, built-in icon or an image from the repo. The image must be an icon file inside the
 *  project: its path is read back as a data URL */
async function applyAppearance(
  db: Parameters<typeof getProject>[0],
  project: { id: string; path: string },
  appearance: z.infer<typeof appearanceSchema>,
) {
  if (
    appearance.iconImage &&
    (!isIconFile(appearance.iconImage) ||
      !(await isPathAllowed(appearance.iconImage, [project.path])))
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Icon must be an image inside the project",
    });
  }
  db.prepare("UPDATE projects SET color = ?, icon = ?, icon_image = ? WHERE id = ?").run(
    appearance.color,
    appearance.icon,
    appearance.iconImage,
    project.id,
  );
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

  create: publicProcedure
    .input(projectCreateSchema.extend({ appearance: appearanceSchema.optional() }))
    .mutation(async ({ ctx, input: { appearance, ...input } }) => {
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

      const project = createProject(ctx.db, {
        ...input,
        gitRemote,
      });
      markCookiesMigrated(ctx.db, project.id);
      // What the user picked in the dialog; otherwise its app icon, found once and kept
      if (appearance) await applyAppearance(ctx.db, project, appearance);
      else await adoptDetectedIcon(ctx.db, project.id).catch(() => {});
      return getProject(ctx.db, project.id) ?? project;
    }),

  rename: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      renameProject(ctx.db, input.id, input.name);
      return getProject(ctx.db, input.id);
    }),

  /** Agent browser: hosts beyond the local ones this project's agents may open, and whether
   *  browser_eval is allowed. A newly added host brings its logins from the old shared session */
  setBrowserHosts: publicProcedure
    .input(
      z.object({
        id: z.string(),
        hosts: z.array(z.string().max(300)).max(MAX_BROWSER_HOSTS * 2),
        allowEval: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = getProject(ctx.db, input.id);
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      const hosts = parseBrowserHosts(input.hosts);
      setProjectBrowserHosts(ctx.db, input.id, hosts);
      if (input.allowEval !== undefined) setProjectBrowserEval(ctx.db, input.id, input.allowEval);
      const added = hosts.filter((h) => !(before.browserHosts ?? []).includes(h));
      await copyCookiesForHosts(input.id, added).catch((err) =>
        logger.warn("[AgentBrowser] cookie copy for new hosts failed:", err),
      );
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

  /** Icons found in the project and its subrepos, as thumbnails to pick from */
  detectIcons: publicProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const project = getProject(ctx.db, input.id);
    return project ? detectProjectIcons(project.path) : [];
  }),

  /** Add project: the folder the user picked, before it is a project. Reads only the fixed
   *  icon file names, so a path from the renderer cannot read anything else */
  detectIconsAt: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .query(async ({ input }) => {
      if (!isAbsolute(input.path) || !existsSync(input.path) || !statSync(input.path).isDirectory())
        return [];
      return detectProjectIcons(input.path);
    }),

  /** The chosen image icon as a data URL (null when the project uses a built-in icon) */
  iconImage: publicProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const project = getProject(ctx.db, input.id);
    return project?.iconImage ? iconDataUrl(project.iconImage) : null;
  }),

  setAppearance: publicProcedure
    .input(appearanceSchema.extend({ id: z.string() }))
    .mutation(async ({ ctx, input: { id, ...appearance } }) => {
      const project = getProject(ctx.db, id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      await applyAppearance(ctx.db, project, appearance);
      return getProject(ctx.db, id);
    }),

  /** T146: move a project into a group (or ungroup with groupId: null). */
  setGroup: publicProcedure
    .input(z.object({ id: z.string(), groupId: z.string().nullable() }))
    .mutation(({ ctx, input }) => {
      updateProjectGroup(ctx.db, input.id, input.groupId);
      return { success: true };
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const project = getProject(ctx.db, input.id);
    if (!project) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.id} not found` });
    }
    // The row cascade drops agents from the DB; their PTYs would keep running unowned
    await Promise.all(
      listLiveAgentIds(ctx.db, input.id).map((id) =>
        ctx.agentManager.stop(ctx.db, id).catch((err) => {
          logger.warn(`[Projects] Failed to stop ${id} before delete:`, err);
        }),
      ),
    );
    deleteProject(ctx.db, input.id);
    setProjectIde(ctx.db, input.id, null);
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
        /** resolve relative `file` against this agent's worktree instead of the project root */
        agentId: z.string().optional(),
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
      const preferred = resolveIde(ctx.db, project.id);
      let target = project.path;
      if (input.file) {
        // Worktree agents print paths relative to their worktree — resolving
        // against the project root would open the version without their edits.
        const base =
          (input.agentId ? getWorktreeByAgentId(ctx.db, input.agentId)?.path : undefined) ??
          project.path;
        const resolved = input.file.startsWith("/") ? input.file : `${base}/${input.file}`;
        if (!existsSync(resolved)) {
          throw new TRPCError({ code: "NOT_FOUND", message: `File not found: ${input.file}` });
        }
        target = resolved;
      }
      const opened = await openInIde(
        target,
        input.ide ?? preferred.ide,
        input.customPath ?? preferred.customPath,
        input.file ? input.line : undefined,
      );
      return { success: true, ...opened };
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

  /** T176: dirty worktrees are flagged because deleting them loses work, which
   *  is the only reason to hesitate. */
  listAllWorktrees: publicProcedure.query(({ ctx }) =>
    Promise.all(
      listAllWorktreeRows(ctx.db).map(async (r) => {
        const exists = existsSync(r.path);
        // git2 on the libuv pool, not a `git status` subprocess per row: this renders on
        // every dashboard mount, and 20 spawns each rewriting .git/index would
        // contend with the agents working in those very worktrees.
        let dirty = false;
        if (exists) {
          try {
            const rust = coreRust;
            dirty = rust ? await runNative(() => rust.worktreeHasChangesAsync(r.path)) : true;
          } catch (err) {
            // Treat an unreadable worktree as DIRTY, matching race-mode: guessing
            // "clean" is what authorises a destructive delete.
            logger.warn(`[Worktrees] dirty check failed for ${r.path}, treating as DIRTY:`, err);
            dirty = true;
          }
        }
        return { ...r, exists, dirty };
      }),
    ),
  ),

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

      if (countLiveAgentsInWorktree(ctx.db, input.worktreeId) > 0) {
        return { success: false, message: "An agent is still working in this worktree" };
      }

      // Run archive hook before deletion (T60: exegol.yaml)
      try {
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
