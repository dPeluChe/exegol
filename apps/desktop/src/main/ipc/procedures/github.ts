import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { acceptsFollowUps, type GitHubIssue, type GitHubRepoRef } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sanitizeAgentMessage } from "../../agents/agent-message-injection";
import { queueFollowUp } from "../../agents/follow-up-queue";
import { hookCwdOf } from "../../agents/hook-cwd";
import { getAgent } from "../../db/queries";
import { listLiveProjectSessions } from "../../db/queries/agents";
import { getProject } from "../../db/queries/projects";
import { detectGhCli } from "../../integrations/github/gh";
import {
  buildTask,
  type GhTarget,
  noOverview,
  projectOverview,
  taskBranch,
} from "../../integrations/github/overview";
import {
  forgetProjectRepos,
  type ProjectRepo,
  parseGitHubRemote,
  projectRepos,
  sessionsByRepo,
} from "../../integrations/github/repos";
import { logger } from "../../lib/logger";
import { pathKey } from "../../lib/worktree-safety";
import { getApiKey } from "../../security/keystore";
import { publicProcedure, router } from "../trpc";

const execFileAsync = promisify(execFile);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build env with optional GH_TOKEN from keystore */
function buildGhEnv(db: Parameters<typeof getApiKey>[0]): Record<string, string | undefined> {
  const env = { ...process.env };
  // Try keystore first, then fall back to existing env
  const storedToken = getApiKey(db, "github");
  if (storedToken) {
    env.GH_TOKEN = storedToken;
  }
  return env;
}

/** Resolve project and parse owner/repo, throwing tRPC errors on failure */
function resolveProjectRepo(
  db: Parameters<typeof getProject>[0],
  projectId: string,
): { repoSlug: string; projectPath: string } {
  const project = getProject(db, projectId);
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Project ${projectId} not found` });
  }
  if (!project.gitRemote) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Project has no git remote configured",
    });
  }
  const repoSlug = parseGitHubRemote(project.gitRemote);
  if (!repoSlug) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Project remote is not a GitHub repo",
    });
  }
  return { repoSlug, projectPath: project.path };
}

const targetOf = (repo: ProjectRepo, env: NodeJS.ProcessEnv): GhTarget => ({
  repo: repo.name,
  folder: repo.folder,
  cwd: repo.path,
  env,
});

function liveSessionsByRepo(
  db: Parameters<typeof getProject>[0],
  projectId: string,
  repos: ProjectRepo[],
): Map<string, string[]> {
  const sessions = listLiveProjectSessions(db, projectId).map(({ id, cwd, worktreeRepo }) => ({
    id,
    cwd: pathKey(hookCwdOf(id) ?? cwd),
    worktreeRepo: worktreeRepo ? pathKey(worktreeRepo) : null,
  }));
  return sessionsByRepo(
    sessions,
    repos.map((r) => ({ folder: r.folder, path: pathKey(r.path) })),
  );
}

async function repoOfTask(
  db: Parameters<typeof getProject>[0],
  projectId: string,
  ref: GitHubRepoRef,
): Promise<ProjectRepo> {
  const project = getProject(db, projectId);
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Project ${projectId} not found` });
  }
  const repos = await projectRepos(project.path);
  const repo = repos.find((r) => r.name === ref.name && r.folder === ref.folder);
  if (!repo) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Repo not found in this project" });
  }
  return repo;
}

const taskInput = z.object({
  projectId: z.string(),
  kind: z.enum(["pr", "issue"]),
  number: z.number().int().positive(),
  fixCi: z.boolean().optional(),
  repo: z.object({ name: z.string().max(200), folder: z.string().max(1000) }),
});

async function taskText(
  db: Parameters<typeof getProject>[0],
  { projectId, ...ref }: z.infer<typeof taskInput>,
  repo: ProjectRepo,
  options: { withLog: boolean; runIn?: string | null },
): Promise<string> {
  const text = await buildTask(ref, targetOf(repo, buildGhEnv(db)), options);
  if (!text) {
    throw new TRPCError({ code: "NOT_FOUND", message: `#${ref.number} is no longer open` });
  }
  return text;
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const githubRouter = router({
  /** Open PRs with CI and open issues for the top bar; `unavailable` says why there are none.
   *  `full`: every repo now, for the open menu; else `dueRepos` picks */
  overview: publicProcedure
    .input(z.object({ projectId: z.string(), full: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      if (!(await detectGhCli())) return noOverview("no-gh");
      const project = getProject(ctx.db, input.projectId);
      if (project && input.full) forgetProjectRepos(project.path);
      const repos = project ? await projectRepos(project.path) : [];
      if (repos.length === 0) return noOverview("no-remote");
      const env = buildGhEnv(ctx.db);
      return projectOverview(
        repos.map((r) => targetOf(r, env)),
        liveSessionsByRepo(ctx.db, input.projectId, repos),
        input.full ?? false,
      );
    }),

  /** The prompt for a new session; built here so what runs comes from gh, not the renderer */
  taskPrompt: publicProcedure.input(taskInput).mutation(async ({ ctx, input }) => {
    const repo = await repoOfTask(ctx.db, input.projectId, input.repo);
    const text = await taskText(ctx.db, input, repo, { withLog: false });
    return {
      prompt: sanitizeAgentMessage(text).trim(),
      branch: taskBranch(repo.folder, input.kind, input.number),
      worktreeRepo: repo.folder ? repo.path : undefined,
    };
  }),

  /** Sent as the user's follow-up: the user assigned it, so it is no automatic notice */
  sendTask: publicProcedure
    .input(taskInput.extend({ agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { agentId, ...task } = input;
      const agent = getAgent(ctx.db, agentId);
      if (agent?.projectId !== task.projectId || !acceptsFollowUps(agent)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Session is not running" });
      }
      const repo = await repoOfTask(ctx.db, task.projectId, task.repo);
      const inRepo = liveSessionsByRepo(ctx.db, task.projectId, [repo]).get(repo.folder);
      const runIn = inRepo?.includes(agentId) ? null : repo.path;
      const text = await taskText(ctx.db, task, repo, { withLog: true, runIn });
      return { delivered: queueFollowUp(ctx.db, agentId, text).delivered };
    }),

  /** List GitHub issues for a project */
  listIssues: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { repoSlug, projectPath } = resolveProjectRepo(ctx.db, input.projectId);

      try {
        const { stdout } = await execFileAsync(
          "gh",
          [
            "issue",
            "list",
            "--repo",
            repoSlug,
            "--state",
            "all",
            "--json",
            "number,title,body,state,labels,assignees,url,createdAt,updatedAt",
            "--limit",
            "100",
          ],
          {
            cwd: projectPath,
            env: buildGhEnv(ctx.db),
            maxBuffer: 5 * 1024 * 1024,
          },
        );

        const raw = JSON.parse(stdout) as Array<{
          number: number;
          title: string;
          body: string | null;
          state: string;
          labels: Array<{ name: string }>;
          assignees: Array<{ login: string }>;
          url: string;
          createdAt: string;
          updatedAt: string;
        }>;

        const issues: GitHubIssue[] = raw.map((r) => ({
          number: r.number,
          title: r.title,
          body: r.body ?? null,
          state: r.state === "CLOSED" ? "closed" : "open",
          labels: r.labels.map((l) => l.name),
          assignees: r.assignees.map((a) => a.login),
          url: r.url,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));

        return issues;
      } catch (err) {
        logger.error("[GitHub] Failed to list issues:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to list GitHub issues: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  /** Close or reopen a GitHub issue */
  updateIssueState: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        issueNumber: z.number(),
        state: z.enum(["open", "closed"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { repoSlug, projectPath } = resolveProjectRepo(ctx.db, input.projectId);
      const action = input.state === "closed" ? "close" : "reopen";

      try {
        await execFileAsync(
          "gh",
          ["issue", action, String(input.issueNumber), "--repo", repoSlug],
          {
            cwd: projectPath,
            env: buildGhEnv(ctx.db),
          },
        );
        return { success: true };
      } catch (err) {
        logger.error(`[GitHub] Failed to ${action} issue #${input.issueNumber}:`, err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to ${action} issue #${input.issueNumber}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  /** Add or remove labels from a GitHub issue */
  updateIssueLabels: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        issueNumber: z.number(),
        addLabels: z.array(z.string()).default([]),
        removeLabels: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { repoSlug, projectPath } = resolveProjectRepo(ctx.db, input.projectId);

      const args = ["issue", "edit", String(input.issueNumber), "--repo", repoSlug];
      for (const label of input.addLabels) {
        args.push("--add-label", label);
      }
      for (const label of input.removeLabels) {
        args.push("--remove-label", label);
      }

      try {
        await execFileAsync("gh", args, {
          cwd: projectPath,
          env: buildGhEnv(ctx.db),
        });
        return { success: true };
      } catch (err) {
        logger.error(`[GitHub] Failed to update labels on issue #${input.issueNumber}:`, err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to update labels on issue #${input.issueNumber}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),
});
