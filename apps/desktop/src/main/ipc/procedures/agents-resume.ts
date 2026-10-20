// agents router, spawn and resume part: spawn, resume after a lost sidecar, shell folders, Watching pins.
import type { ResumableSession, SpawnPreview } from "@exegol/shared";
import { agentCliTypeSchema, agentCreateSchema } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { continueLastPart } from "../../agents/agent-spawn-flow";
import {
  folderExists,
  followChain,
  noteShellFolder,
  shellResumeFolder,
} from "../../agents/auto-resume";
import { finishAutoResume, planLostResume } from "../../agents/auto-resume-plan";
import { settleLost, takeLostOnRestart } from "../../agents/lost-sessions";
import { providerSessionId } from "../../agents/provider-session-id";
import { resolveSpawnTarget } from "../../agents/spawn-target";
import { resolveTaskLabel } from "../../agents/task-label";
import {
  createAgent,
  getAgent,
  getProject,
  listWorktrees,
  updateAgentStatus,
} from "../../db/queries";
import {
  AGENT_FOLDER_SQL,
  archiveAgent,
  getAgentCwd,
  getAgentLastCwd,
  resumedInto,
  setAgentLastCwd,
  setAgentResumedFrom,
  watchedInfo,
} from "../../db/queries/agents";
import { cliSessionNames, lastLocalSession } from "../../history";
import { logger } from "../../lib/logger";
import { isPathAllowed } from "../../security/path-guard";
import { redact } from "../../system/diagnostics";
import { publicProcedure } from "../trpc";

async function resumedShellFolder(
  db: Parameters<typeof getAgentLastCwd>[0],
  fromId: string,
  bases: string[],
): Promise<string | undefined> {
  const last = getAgentLastCwd(db, fromId);
  const exists = folderExists(last);
  const allowed = exists && bases.length > 0 && (await isPathAllowed(last as string, bases));
  const { cwd, decision } = shellResumeFolder(last, exists, allowed);
  const where = decision === "kept" ? "folder kept" : `folder ${decision}, project root`;
  noteShellFolder(fromId, decision);
  if (decision !== "none") logger.info(`[Resume] ${fromId} shell: ${where}`);
  return cwd;
}

/** An agent the launcher started in a folder resumes there: its CLI keyed the session by it */
async function resumedAgentFolder(
  db: Parameters<typeof getAgentLastCwd>[0],
  fromId: string,
  bases: string[],
): Promise<string | undefined> {
  const last = getAgentLastCwd(db, fromId);
  if (!last || !folderExists(last) || bases.length === 0) return undefined;
  return (await isPathAllowed(last, bases)) ? last : undefined;
}

/** A crashed row whose session now runs in a new one: archived here, not by the renderer, so a
 *  reload in between never leaves a Resume that starts a second process on the same session */
function retireResumedSource(db: Parameters<typeof getAgent>[0], id: string): void {
  settleLost([id]);
  if (getAgent(db, id)?.status === "crashed") archiveAgent(db, id);
}

/** One line of why a resume failed, without paths (the log goes into public bug reports) */
function resumeFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return redact(message.split("\n")[0] ?? "").slice(0, 160);
}

export const agentSpawnProcedures = {
  /** Sessions a restart took with the sidecar that are not settled yet (a reload mid-stagger
   *  gets the rest): the recent ones to resume in their panes, the rest kept suspended */
  takeLostOnRestart: publicProcedure
    .input(z.object({ pinned: z.array(z.string().max(128)).max(256).default([]) }).optional())
    .query(async ({ ctx, input }) =>
      planLostResume(ctx.db, await takeLostOnRestart(), Date.now(), new Set(input?.pinned)),
    ),

  /** Watching pins follow their session: each id's newest continuation, and what the session
   *  was when none is live (archived rows included) */
  resolveWatched: publicProcedure
    .input(z.object({ ids: z.array(z.string().max(128)).max(256) }))
    .query(({ ctx, input }) =>
      input.ids.map((id) => {
        const latest = followChain(id, (cur) => resumedInto(ctx.db, cur));
        return { id, latest, info: watchedInfo(ctx.db, latest) };
      }),
    ),

  /** How the renderer's staggered auto-resume went, for the log */
  autoResumeReport: publicProcedure
    .input(
      z.object({
        outcomes: z
          .array(
            z.object({
              id: z.string().max(128),
              cliType: z.string().regex(/^[\w-]{1,40}$/),
              outcome: z.enum(["resumed", "failed", "skipped"]),
              // Cut, never refused: one long error must not drop the whole report
              reason: z
                .string()
                .optional()
                .transform((r) => r?.slice(0, 120)),
            }),
          )
          .max(1000),
        totalMs: z.number().int().nonnegative(),
        kept: z.number().int().nonnegative(),
      }),
    )
    .mutation(({ ctx, input }) => {
      finishAutoResume(
        ctx.db,
        input.outcomes.map((o) => ({ ...o, reason: o.reason && redact(o.reason) })),
        input.totalMs,
        input.kept,
      );
    }),

  /** A shell's folder from OSC 7: its resume reopens there */
  setShellCwd: publicProcedure
    .input(
      z.object({
        id: z.string().max(128),
        cwd: z
          .string()
          .min(1)
          .max(4096)
          .startsWith("/")
          .refine((c) => !c.includes("\0"), "NUL in path"),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (getAgent(ctx.db, input.id)?.cliType === "shell") {
        setAgentLastCwd(ctx.db, input.id, input.cwd);
      }
    }),

  /** Shell id → provider of an agent CLI typed inside it (`claude` in a plain terminal) */
  /** A CLI typed in a terminal exited back to the prompt: start it again there, continuing
   *  its last conversation (the provider's resume flag), in the same shell and cwd */
  continueInShell: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const agent = getAgent(ctx.db, input.id);
      if (!agent?.launchedInShell || agent.status !== "idle") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Not at its shell prompt" });
      }
      const provider = ctx.providerRegistry.get(agent.cliType);
      if (!provider?.command || provider.command.startsWith("__")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No command for this CLI" });
      }
      const cwd = getAgentCwd(ctx.db, agent.id);
      const last = cwd ? await lastLocalSession(agent.cliType, cwd) : undefined;
      const command = [
        provider.command,
        continueLastPart(agent.cliType, provider.capabilities, last?.sessionId ?? null),
      ]
        .filter(Boolean)
        .join(" ");
      ctx.agentManager.write(agent.id, `${command}\r`);
      return { command };
    }),

  /** T155.5: past sessions of ANY provider that captured a resume handle, newest first. */
  listResumable: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const rows = ctx.db
        .prepare(
          `SELECT a.id, a.cli_type, a.task_description, a.status, a.started_at, a.stopped_at,
                  a.alias, ${AGENT_FOLDER_SQL} AS folder
           FROM agents a
           LEFT JOIN worktrees w ON w.id = a.worktree_id
           JOIN projects p ON p.id = a.project_id
           WHERE a.project_id = ?
             AND a.status IN ('completed', 'failed', 'stopped', 'crashed')
             AND a.archived_at IS NULL
           AND (a.resume_command IS NOT NULL OR a.claude_session_id IS NOT NULL)
           ORDER BY COALESCE(a.stopped_at, a.started_at) DESC
           LIMIT ?`,
        )
        .all(input.projectId, input.limit ?? 10) as Array<{
        id: string;
        cli_type: string;
        task_description: string;
        status: string;
        started_at: number | null;
        stopped_at: number | null;
        alias: string | null;
        folder: string | null;
      }>;
      return rows.map<ResumableSession>((r) => ({
        agentId: r.id,
        cliType: r.cli_type,
        // The codename is how the user (and other agents) knew this session —
        // a resume picker listing only task text makes them re-identify it.
        alias: r.alias,
        taskDescription: r.task_description,
        status: r.status,
        endedAt: r.stopped_at ?? r.started_at,
        folder: r.folder,
      }));
    }),

  /** The launcher's past-session chips: each agent's session name inside its CLI, by agent id.
   *  Separate from listResumable so the chips render before any store is read */
  sessionNames: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        agentIds: z.array(z.string().max(64)).max(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.agentIds.length === 0) return {};
      const rows = ctx.db
        .prepare(
          `SELECT a.id, a.cli_type, a.task_description, a.claude_session_id, a.resume_command,
                  ${AGENT_FOLDER_SQL} AS cwd
           FROM agents a
           LEFT JOIN worktrees w ON w.id = a.worktree_id
           JOIN projects p ON p.id = a.project_id
           WHERE a.project_id = ? AND a.id IN (${input.agentIds.map(() => "?").join(",")})`,
        )
        .all(input.projectId, ...input.agentIds) as Array<{
        id: string;
        cli_type: string;
        task_description: string;
        claude_session_id: string | null;
        resume_command: string | null;
        cwd: string;
      }>;
      const refs = rows.flatMap((r) => {
        const sessionId = providerSessionId(r.cli_type, r.claude_session_id, r.resume_command);
        return sessionId
          ? [
              {
                agentId: r.id,
                provider: r.cli_type,
                sessionId,
                cwd: r.cwd,
                task: r.task_description,
              },
            ]
          : [];
      });
      return refs.length > 0 ? cliSessionNames(refs) : {};
    }),

  /** Where a spawn would actually run — the same resolver the spawn path uses,
   *  so the modal cannot promise a directory the agent never gets. */
  previewSpawn: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        useWorktree: z.boolean(),
        branchName: z.string().optional(),
        taskDescription: z.string().optional(),
        /** Needed because the blank-task fallback is the provider's name.
         *  Validated here rather than widening the domain type inland. */
        cliType: agentCliTypeSchema,
      }),
    )
    .query(({ ctx, input }): SpawnPreview => {
      const project = getProject(ctx.db, input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.projectId} not found` });
      }
      // Through the SAME label resolution the spawn will apply: createAgent
      // turns a blank task into the provider's display name, and the branch is
      // slugged from THAT. Previewing the raw task promised `exegol/` while the
      // agent landed on `exegol/claude-code` — the exact class of lie this
      // procedure exists to remove.
      const target = resolveSpawnTarget(ctx.db, project, {
        ...input,
        taskDescription: resolveTaskLabel(input.cliType, input.taskDescription),
      });
      return { cwd: target.cwd, branchName: target.branchName, reused: target.reused };
    }),

  spawn: publicProcedure.input(agentCreateSchema).mutation(async ({ ctx, input: raw }) => {
    const project = getProject(ctx.db, raw.projectId);
    const bases = project
      ? [project.path, ...listWorktrees(ctx.db, project.id).map((w) => w.path)]
      : [];
    // A resumed shell reopens in its last OSC 7 folder while that is still in the project; an
    // agent in the folder it was started in
    const from = raw.cwdOverride ? undefined : raw.resumeFromAgentId;
    const resumeFolder = !from
      ? undefined
      : raw.cliType === "shell"
        ? await resumedShellFolder(ctx.db, from, bases)
        : await resumedAgentFolder(ctx.db, from, bases);
    const input = resumeFolder ? { ...raw, cwdOverride: resumeFolder } : raw;
    // A renderer-chosen start folder (the launcher's "run in", a terminal beside a session)
    // stays inside the project or one of its worktrees
    if (input.cwdOverride) {
      if (!project || !(await isPathAllowed(input.cwdOverride, bases))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Start folder is outside the project" });
      }
    }
    const agent = createAgent(ctx.db, input);
    // An agent's start folder: its resume, session list and links read it (AGENT_FOLDER_SQL)
    if (input.cwdOverride) setAgentLastCwd(ctx.db, agent.id, input.cwdOverride);
    const manager = ctx.agentManager;

    const resumedFrom = input.resumeFromAgentId;
    const fresh = input.resumeSession ? "" : " (fresh start, no session to resume)";
    try {
      await manager.spawn(ctx.db, agent, input);
      if (resumedFrom) {
        logger.info(`[Resume] ${resumedFrom} -> ${agent.id} ok${fresh}`);
        setAgentResumedFrom(ctx.db, agent.id, resumedFrom);
        retireResumedSource(ctx.db, resumedFrom);
      }
    } catch (err) {
      if (resumedFrom) {
        logger.warn(`[Resume] ${resumedFrom} -> ${agent.id} failed ${resumeFailure(err)}${fresh}`);
      }
      updateAgentStatus(ctx.db, agent.id, "failed", String(err));
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to spawn agent: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const spawned = getAgent(ctx.db, agent.id);
    if (!spawned) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Agent ${agent.id} not found after spawn`,
      });
    }
    return spawned;
  }),
};
