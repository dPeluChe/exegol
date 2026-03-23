import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitHubIssue } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getProject } from "../../db/queries/projects";
import { logger } from "../../lib/logger";
import { getApiKey } from "../../security/keystore";
import { publicProcedure, router } from "../trpc";

const execFileAsync = promisify(execFile);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse owner/repo from a GitHub remote URL (HTTPS or SSH) */
function parseOwnerRepo(gitRemote: string): { owner: string; repo: string } | null {
  // HTTPS: https://github.com/owner/repo.git or https://github.com/owner/repo
  const httpsMatch = gitRemote.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (httpsMatch?.[1] && httpsMatch[2]) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  // SSH: git@github.com:owner/repo.git
  const sshMatch = gitRemote.match(/git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshMatch?.[1] && sshMatch[2]) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}

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
): { owner: string; repo: string; projectPath: string } {
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
  const parsed = parseOwnerRepo(project.gitRemote);
  if (!parsed) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Cannot parse GitHub owner/repo from remote: ${project.gitRemote}`,
    });
  }
  return { ...parsed, projectPath: project.path };
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const githubRouter = router({
  /** List GitHub issues for a project */
  listIssues: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { owner, repo, projectPath } = resolveProjectRepo(ctx.db, input.projectId);
      const repoSlug = `${owner}/${repo}`;

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
      const { owner, repo, projectPath } = resolveProjectRepo(ctx.db, input.projectId);
      const repoSlug = `${owner}/${repo}`;
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
      const { owner, repo, projectPath } = resolveProjectRepo(ctx.db, input.projectId);
      const repoSlug = `${owner}/${repo}`;

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
